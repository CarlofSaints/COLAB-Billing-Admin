"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  companyAllocations,
  fixedLineItems,
  fixedLineAllocations,
  appSettings,
  commonSpaces,
  commonSpaceSplits,
} from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { TOTAL_SQM_KEY, RENT_AMOUNT_KEY } from "@/lib/controls";

export type ActionState = { error?: string; ok?: boolean };

async function setSetting(key: string, value: string) {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Save the total building area + the square-metre figure for every sub-company. */
export async function saveSquareMetres(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("controls.manage");

  // Total building floor area (drives the common-space calculation).
  const totalRaw = formData.get("total_sqm");
  if (totalRaw != null) {
    const total = Number(totalRaw);
    if (Number.isFinite(total) && total >= 0) {
      await setSetting(TOTAL_SQM_KEY, total.toFixed(2));
    }
  }

  // Monthly rent — split across companies by their effective floor-space share.
  const rentRaw = formData.get("rent_amount");
  if (rentRaw != null) {
    const rent = Number(rentRaw);
    if (Number.isFinite(rent) && rent >= 0) {
      await setSetting(RENT_AMOUNT_KEY, rent.toFixed(2));
    }
  }

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
    summary: "Updated total area and square-metre allocations",
    actor: user,
    entityType: "control",
  });

  revalidatePath("/controls");
  return { ok: true };
}

/* -------------------- Common spaces -------------------- */

const commonSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  squareMetres: z.coerce.number().nonnegative(),
  splitMethod: z.enum(["occupancy", "custom"]),
});

/**
 * Create or update a common-space line. When the split method is "custom",
 * per-company percentages arrive as `pct_<companyId>` fields and are stored
 * as the space's split rows (replacing any existing ones).
 */
export async function saveCommonSpace(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("controls.manage");
  const id = formData.get("id") ? Number(formData.get("id")) : null;

  const parsed = commonSchema.safeParse({
    name: formData.get("name"),
    squareMetres: formData.get("squareMetres") || 0,
    splitMethod: formData.get("splitMethod") || "occupancy",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Collect custom percentages (only relevant for the "custom" method).
  const pcts: { companyId: number; percent: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("pct_")) continue;
    const companyId = Number(key.slice(4));
    const percent = Number(value);
    if (!companyId || !Number.isFinite(percent) || percent <= 0) continue;
    pcts.push({ companyId, percent });
  }

  if (parsed.data.splitMethod === "custom") {
    const sum = pcts.reduce((s, p) => s + p.percent, 0);
    if (pcts.length === 0) return { error: "Add at least one company percentage." };
    if (Math.abs(sum - 100) > 0.01) {
      return { error: `Custom percentages must add up to 100% (currently ${sum.toFixed(1)}%).` };
    }
  }

  let spaceId = id;
  if (id) {
    await db
      .update(commonSpaces)
      .set({
        name: parsed.data.name,
        squareMetres: parsed.data.squareMetres.toFixed(2),
        splitMethod: parsed.data.splitMethod,
        updatedAt: new Date(),
      })
      .where(eq(commonSpaces.id, id));
  } else {
    const [row] = await db
      .insert(commonSpaces)
      .values({
        name: parsed.data.name,
        squareMetres: parsed.data.squareMetres.toFixed(2),
        splitMethod: parsed.data.splitMethod,
      })
      .returning();
    spaceId = row.id;
  }

  // Replace split rows.
  if (spaceId) {
    await db.delete(commonSpaceSplits).where(eq(commonSpaceSplits.commonSpaceId, spaceId));
    if (parsed.data.splitMethod === "custom" && pcts.length > 0) {
      await db.insert(commonSpaceSplits).values(
        pcts.map((p) => ({
          commonSpaceId: spaceId!,
          companyId: p.companyId,
          percent: p.percent.toFixed(2),
        })),
      );
    }
  }

  await logEvent({
    action: id ? "controls.common_space_update" : "controls.common_space_add",
    summary: `${id ? "Updated" : "Added"} common space “${parsed.data.name}”`,
    actor: user,
    entityType: "common_space",
    entityId: spaceId ?? undefined,
    metadata: { splitMethod: parsed.data.splitMethod, sqm: parsed.data.squareMetres },
  });

  revalidatePath("/controls");
  return { ok: true };
}

export async function deleteCommonSpace(id: number) {
  const user = await requirePermission("controls.manage");
  await db.delete(commonSpaces).where(eq(commonSpaces.id, id));
  await logEvent({
    action: "controls.common_space_delete",
    summary: "Removed a common space",
    actor: user,
    entityType: "common_space",
    entityId: id,
  });
  revalidatePath("/controls");
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

/**
 * Create or update a fixed line item (shared name + unit price) and its
 * per-company quantity allocations. Companies arrive as repeated `companyId`
 * fields; each selected company's quantity as `qty_<companyId>` (defaults to 1).
 */
export async function saveFixedItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("controls.manage");
  const id = formData.get("id") ? Number(formData.get("id")) : null;

  const name = String(formData.get("name") ?? "").trim();
  const unitAmount = Number(formData.get("unitAmount") || 0);
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!name) return { error: "Description is required." };
  if (!Number.isFinite(unitAmount) || unitAmount < 0) return { error: "Enter a valid amount." };

  const companyIds = formData
    .getAll("companyId")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (companyIds.length === 0) return { error: "Assign at least one sub-company." };

  const allocations = companyIds.map((cid) => {
    const q = Number(formData.get(`qty_${cid}`));
    return { companyId: cid, quantity: Number.isFinite(q) && q >= 0 ? q : 1 };
  });

  let itemId = id;
  if (id) {
    await db
      .update(fixedLineItems)
      .set({ name, unitAmount: unitAmount.toFixed(2), notes, updatedAt: new Date() })
      .where(eq(fixedLineItems.id, id));
  } else {
    const [row] = await db
      .insert(fixedLineItems)
      .values({ name, unitAmount: unitAmount.toFixed(2), notes })
      .returning();
    itemId = row.id;
  }

  // Replace the allocation set.
  await db.delete(fixedLineAllocations).where(eq(fixedLineAllocations.fixedLineItemId, itemId!));
  await db.insert(fixedLineAllocations).values(
    allocations.map((a) => ({
      fixedLineItemId: itemId!,
      companyId: a.companyId,
      quantity: a.quantity.toFixed(2),
    })),
  );

  await logEvent({
    action: id ? "controls.fixed_update" : "controls.fixed_add",
    summary: `${id ? "Updated" : "Added"} fixed line item “${name}” (${allocations.length} companies)`,
    actor: user,
    entityType: "fixed_line_item",
    entityId: itemId ?? undefined,
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
