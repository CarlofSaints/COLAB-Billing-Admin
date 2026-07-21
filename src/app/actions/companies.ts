"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { companies, companyAllocations } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

const companySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  regNumber: z.string().trim().optional(),
  vatNumber: z.string().trim().optional(),
  registeredAddress: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  contactEmail: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type ActionState = { error?: string; ok?: boolean };

function parse(formData: FormData) {
  return companySchema.safeParse({
    name: formData.get("name"),
    regNumber: formData.get("regNumber") || undefined,
    vatNumber: formData.get("vatNumber") || undefined,
    registeredAddress: formData.get("registeredAddress") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    notes: formData.get("notes") || undefined,
  });
}

export async function createCompany(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("companies.manage");
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .insert(companies)
    .values({ ...parsed.data, type: "sub" })
    .returning();

  // Every sub-company gets an allocation row so it surfaces in the controls.
  await db.insert(companyAllocations).values({ companyId: row.id }).onConflictDoNothing();

  await logEvent({
    action: "company.create",
    summary: `Created sub-company “${row.name}”`,
    actor: user,
    entityType: "company",
    entityId: row.id,
    metadata: { name: row.name },
  });

  revalidatePath("/companies");
  revalidatePath("/controls");
  return { ok: true };
}

export async function updateCompany(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("companies.manage");
  const id = Number(formData.get("id"));
  if (!id) return { error: "Missing company id" };

  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await db
    .update(companies)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(companies.id, id));

  await logEvent({
    action: "company.update",
    summary: `Updated sub-company “${parsed.data.name}”`,
    actor: user,
    entityType: "company",
    entityId: id,
  });

  revalidatePath("/companies");
  revalidatePath("/controls");
  return { ok: true };
}

export async function setCompanyActive(id: number, active: boolean) {
  const user = await requirePermission("companies.manage");
  await db.update(companies).set({ active, updatedAt: new Date() }).where(eq(companies.id, id));
  await logEvent({
    action: "company.set_active",
    summary: `${active ? "Activated" : "Deactivated"} a sub-company`,
    actor: user,
    entityType: "company",
    entityId: id,
    metadata: { active },
  });
  revalidatePath("/companies");
  revalidatePath("/controls");
}
