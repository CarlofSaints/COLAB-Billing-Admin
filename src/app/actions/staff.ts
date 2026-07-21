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
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Surname is required"),
  cellNumber: z.string().trim().optional(),
  email: z.string().trim().optional(),
  position: z.string().trim().optional(),
  companyId: z.coerce.number().int().positive("Choose a company"),
});

export type ActionState = { error?: string; ok?: boolean };

function parse(formData: FormData) {
  return staffSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    cellNumber: formData.get("cellNumber") || undefined,
    email: formData.get("email") || undefined,
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
    summary: `Added staff member ${row.firstName} ${row.lastName}`,
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
    summary: `Updated staff member ${parsed.data.firstName} ${parsed.data.lastName}`,
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
  skipped?: number;
  unknownCompanies?: string[];
};

/**
 * Bulk import staff from an Excel/CSV file. Expected columns (case-insensitive,
 * flexible headers): First Name, Surname/Last Name, Cell/Phone, Email, Company.
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

  const pick = (row: Record<string, unknown>, keys: string[]): string => {
    for (const k of Object.keys(row)) {
      const norm = k.trim().toLowerCase().replace(/[\s_]+/g, "");
      if (keys.includes(norm)) return String(row[k] ?? "").trim();
    }
    return "";
  };

  let imported = 0;
  let skipped = 0;
  const unknown = new Set<string>();
  const toInsert: (typeof staff.$inferInsert)[] = [];

  for (const row of rows) {
    const firstName = pick(row, ["firstname", "name", "first"]);
    const lastName = pick(row, ["surname", "lastname", "last"]);
    const cellNumber = pick(row, ["cell", "cellnumber", "phone", "mobile", "cellphone"]);
    const email = pick(row, ["email", "emailaddress", "mail"]);
    const position = pick(row, ["position", "role", "title", "jobtitle"]);
    const companyName = pick(row, ["company", "subcompany", "business", "entity"]);

    if (!firstName || !lastName) {
      skipped++;
      continue;
    }
    const companyId = companyByName.get(companyName.trim().toLowerCase());
    if (!companyId) {
      if (companyName) unknown.add(companyName);
      skipped++;
      continue;
    }
    toInsert.push({
      firstName,
      lastName,
      cellNumber: cellNumber || null,
      email: email || null,
      position: position || null,
      companyId,
    });
    imported++;
  }

  if (toInsert.length > 0) {
    await db.insert(staff).values(toInsert);
  }

  await logEvent({
    action: "staff.import",
    summary: `Imported ${imported} staff member(s) from ${file.name}`,
    actor: user,
    entityType: "staff",
    metadata: { imported, skipped, file: file.name, unknownCompanies: Array.from(unknown) },
  });

  revalidatePath("/staff");
  return { imported, skipped, unknownCompanies: Array.from(unknown) };
}
