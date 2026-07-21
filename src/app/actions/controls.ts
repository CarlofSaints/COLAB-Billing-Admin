"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { companyAllocations, fixedLineItems } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

export type ActionState = { error?: string; ok?: boolean };

/** Save the square-metre figure for every sub-company at once. */
export async function saveSquareMetres(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("controls.manage");

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("sqm_")) continue;
    const companyId = Number(key.slice(4));
    if (!companyId) continue;
    const sqm = Number(value);
    if (!Number.isFinite(sqm) || sqm < 0) continue;
    await db
      .insert(companyAllocations)
      .values({ companyId, squareMetres: sqm.toFixed(2) })
      .onConflictDoUpdate({
        target: companyAllocations.companyId,
        set: { squareMetres: sqm.toFixed(2), updatedAt: new Date() },
      });
  }

  await logEvent({
    action: "controls.sqm_update",
    summary: "Updated square-metre allocations",
    actor: user,
    entityType: "control",
  });

  revalidatePath("/controls");
  return { ok: true };
}

/** Save optional headcount overrides. Blank = use the live staff count. */
export async function saveHeadcounts(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("controls.manage");

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("hc_")) continue;
    const companyId = Number(key.slice(3));
    if (!companyId) continue;
    const raw = String(value).trim();
    const override = raw === "" ? null : Number(raw);
    if (override != null && (!Number.isInteger(override) || override < 0)) continue;

    await db
      .insert(companyAllocations)
      .values({ companyId, headcountOverride: override })
      .onConflictDoUpdate({
        target: companyAllocations.companyId,
        set: { headcountOverride: override, updatedAt: new Date() },
      });
  }

  await logEvent({
    action: "controls.headcount_update",
    summary: "Updated headcount overrides",
    actor: user,
    entityType: "control",
  });

  revalidatePath("/controls");
  return { ok: true };
}

const fixedSchema = z.object({
  companyId: z.coerce.number().int().positive("Choose a company"),
  name: z.string().trim().min(1, "Description is required"),
  quantity: z.coerce.number().nonnegative(),
  unitAmount: z.coerce.number().nonnegative(),
  notes: z.string().trim().optional(),
});

export async function addFixedItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("controls.manage");
  const parsed = fixedSchema.safeParse({
    companyId: formData.get("companyId"),
    name: formData.get("name"),
    quantity: formData.get("quantity") || 1,
    unitAmount: formData.get("unitAmount") || 0,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db
    .insert(fixedLineItems)
    .values({
      companyId: parsed.data.companyId,
      name: parsed.data.name,
      quantity: parsed.data.quantity.toFixed(2),
      unitAmount: parsed.data.unitAmount.toFixed(2),
      notes: parsed.data.notes ?? null,
    })
    .returning();

  await logEvent({
    action: "controls.fixed_add",
    summary: `Added fixed line item “${row.name}”`,
    actor: user,
    entityType: "fixed_line_item",
    entityId: row.id,
  });

  revalidatePath("/controls");
  return { ok: true };
}

export async function deleteFixedItem(id: number) {
  const user = await requirePermission("controls.manage");
  await db.delete(fixedLineItems).where(eq(fixedLineItems.id, id));
  await logEvent({
    action: "controls.fixed_delete",
    summary: "Removed a fixed line item",
    actor: user,
    entityType: "fixed_line_item",
    entityId: id,
  });
  revalidatePath("/controls");
}
