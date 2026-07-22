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
  contactName2: z.string().trim().optional(),
  contactEmail2: z.string().trim().optional(),
  contactName3: z.string().trim().optional(),
  contactEmail3: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type ActionState = { error?: string; ok?: boolean };

/**
 * Links (or unlinks) the Xero contact a sub-company is invoiced as. The name
 * is stored alongside the id so the UI can still show what it points at when
 * Xero is unreachable.
 */
export async function setXeroContact(
  companyId: number,
  contactId: string | null,
  contactName: string | null,
): Promise<{ error?: string; ok?: boolean }> {
  const user = await requirePermission("companies.manage");

  if (contactId) {
    // One Xero contact can't front two sub-companies — their invoices would
    // be indistinguishable in Xero.
    const clash = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.xeroContactId, contactId));
    const other = clash.find((c) => c.id !== companyId);
    if (other) return { error: `That Xero contact is already linked to ${other.name}.` };
  }

  await db
    .update(companies)
    .set({
      xeroContactId: contactId,
      xeroContactName: contactId ? contactName : null,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId));

  await logEvent({
    action: contactId ? "company.xero_link" : "company.xero_unlink",
    summary: contactId
      ? `Linked a sub-company to Xero contact “${contactName}”`
      : "Unlinked a sub-company from its Xero contact",
    actor: user,
    entityType: "company",
    entityId: companyId,
    metadata: { contactId },
  });

  revalidatePath("/companies");
  return { ok: true };
}

function parse(formData: FormData) {
  return companySchema.safeParse({
    name: formData.get("name"),
    regNumber: formData.get("regNumber") || undefined,
    vatNumber: formData.get("vatNumber") || undefined,
    registeredAddress: formData.get("registeredAddress") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    contactName2: formData.get("contactName2") || undefined,
    contactEmail2: formData.get("contactEmail2") || undefined,
    contactName3: formData.get("contactName3") || undefined,
    contactEmail3: formData.get("contactEmail3") || undefined,
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
