"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import * as XLSX from "xlsx";
import { db } from "@/db";
import { staff, companies } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

const staffSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  cellNumber: z.string().trim().optional(),
  email: z.string().trim().optional(),
  gender: z.string().trim().optional(),
  position: z.string().trim().optional(),
  companyId: z.coerce.number().int().positive("Choose a company"),
});

export type ActionState = { error?: string; ok?: boolean };

function parse(formData: FormData) {
  return staffSchema.safeParse({
    name: formData.get("name"),
    cellNumber: formData.get("cellNumber") || undefined,
    email: formData.get("email") || undefined,
    gender: formData.get("gender") || undefined,
    position: formData.get("position") || undefined,
    companyId: formData.get("companyId"),
  });
}

export async function createStaff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("staff.manage");
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db.insert(staff).values(parsed.data).returning();
  await logEvent({
    action: "staff.create",
    summary: `Added staff member ${row.name}`,
    actor: user,
    entityType: "staff",
    entityId: row.id,
  });

  revalidatePath("/staff");
  return { ok: true };
}

export async function updateStaff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("staff.manage");
  const id = Number(formData.get("id"));
  if (!id) return { error: "Missing staff id" };
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await db.update(staff).set({ ...parsed.data, updatedAt: new Date() }).where(eq(staff.id, id));
  await logEvent({
    action: "staff.update",
    summary: `Updated staff member ${parsed.data.name}`,
    actor: user,
    entityType: "staff",
    entityId: id,
  });

  revalidatePath("/staff");
  return { ok: true };
}

export async function deleteStaff(id: number) {
  const user = await requirePermission("staff.manage");
  await db.delete(staff).where(eq(staff.id, id));
  await logEvent({
    action: "staff.delete",
    summary: `Removed a staff member`,
    actor: user,
    entityType: "staff",
    entityId: id,
  });
  revalidatePath("/staff");
}

export type ImportState = {
  error?: string;
  imported?: number;
  updated?: number;
  skipped?: number;
  unknownCompanies?: string[];
};

/**
 * Bulk import staff from an Excel/CSV file. Expected columns (case-insensitive,
 * flexible headers): Sub Company, Name, Gender, Email, Cell Number.
 *
 * Upserts: an existing person (matched by email, else by name + company) is
 * updated in place rather than duplicated. Returns how many were added vs
 * updated (the "duplicates" that were merged).
 */
export async function importStaff(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requirePermission("staff.manage");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Please choose a file to upload." };
  }

  let rows: Record<string, unknown>[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  } catch {
    return { error: "Could not read that file. Use .xlsx, .xls or .csv." };
  }

  // Map company names to ids (case-insensitive), COLAB included.
  const allCompanies = await db.select().from(companies);
  const companyByName = new Map(allCompanies.map((c) => [c.name.trim().toLowerCase(), c.id]));

  // Existing staff, for de-dupe / upsert.
  const existing = await db
    .select({
      id: staff.id,
      email: staff.email,
      name: staff.name,
      companyId: staff.companyId,
    })
    .from(staff);

  const byEmail = new Map<string, number>();
  const byNameCompany = new Map<string, number>();
  const nameKey = (n: string, c: number) => `${n.trim().toLowerCase()}|${c}`;
  for (const s of existing) {
    if (s.email) byEmail.set(s.email.trim().toLowerCase(), s.id);
    byNameCompany.set(nameKey(s.name, s.companyId), s.id);
  }

  const pick = (row: Record<string, unknown>, keys: string[]): string => {
    for (const k of Object.keys(row)) {
      const norm = k.trim().toLowerCase().replace(/[\s_]+/g, "");
      if (keys.includes(norm)) return String(row[k] ?? "").trim();
    }
    return "";
  };

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const unknown = new Set<string>();

  for (const row of rows) {
    const name = pick(row, ["name", "fullname", "firstname", "first"]);
    const cellNumber = pick(row, ["cell", "cellnumber", "phone", "mobile", "cellphone"]);
    const email = pick(row, ["email", "emailaddress", "mail"]);
    const gender = pick(row, ["gender", "sex"]);
    const position = pick(row, ["position", "role", "title", "jobtitle"]);
    const companyName = pick(row, ["company", "subcompany", "business", "entity"]);

    // Only a Name and a valid Sub Company are required; everything else is optional.
    if (!name) {
      skipped++;
      continue;
    }
    const companyId = companyByName.get(companyName.trim().toLowerCase());
    if (!companyId) {
      if (companyName) unknown.add(companyName);
      skipped++;
      continue;
    }

    const emailKey = email ? email.trim().toLowerCase() : "";
    const matchId =
      (emailKey && byEmail.get(emailKey)) || byNameCompany.get(nameKey(name, companyId));

    const values = {
      name,
      cellNumber: cellNumber || null,
      email: email || null,
      gender: gender || null,
      position: position || null,
      companyId,
    };

    if (matchId) {
      await db
        .update(staff)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(staff.id, matchId));
      updated++;
    } else {
      const [inserted] = await db.insert(staff).values(values).returning({ id: staff.id });
      imported++;
      // Keep maps current so later rows in the same file de-dupe against this one.
      if (emailKey) byEmail.set(emailKey, inserted.id);
      byNameCompany.set(nameKey(name, companyId), inserted.id);
    }
  }

  await logEvent({
    action: "staff.import",
    summary: `Imported staff from ${file.name}: ${imported} added, ${updated} updated`,
    actor: user,
    entityType: "staff",
    metadata: { imported, updated, skipped, file: file.name, unknownCompanies: Array.from(unknown) },
  });

  revalidatePath("/staff");
  return { imported, updated, skipped, unknownCompanies: Array.from(unknown) };
}
