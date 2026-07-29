/**
 * Costed tags — "Parking is R850 a bay, and these people have a bay".
 *
 * A tag with a `costPerPerson` is billable. It keeps one `fixed_line_items`
 * row mirroring it, so every existing link (expense account → item, supplier
 * line → item, creditor → item) works on it untouched. What the tag changes
 * is where the per-company quantity comes from: instead of a hand-typed
 * `fixed_line_allocations` row, it is counted live from who carries the tag.
 *
 * That means the recurring run and the month-end recovery figure must agree on
 * the count, so both go through `resolveFixedAllocations` below rather than
 * reading the allocations table directly.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { fixedLineItems, staff, staffTags, tags } from "@/db/schema";

/** A company's share of an item, however it was arrived at. */
export type ResolvedAllocation = {
  companyId: number;
  quantity: number;
  /** True when the quantity was counted from a tag rather than typed in. */
  fromTag: boolean;
};

type ItemLike = { id: number; tagId: number | null };
type AllocLike = { fixedLineItemId: number; companyId: number; quantity: string | number };

/**
 * How many people carry each tag, per sub-company.
 *
 * Uses the same filter as the headcount split (`invoice-engine.ts`): active,
 * and flagged "Include in Billing". Someone deliberately kept out of billing
 * must not be billed back in through a tag.
 */
export async function tagHeadcounts(): Promise<Map<number, Map<number, number>>> {
  const rows = await db
    .select({
      tagId: staffTags.tagId,
      companyId: staff.companyId,
      count: sql<number>`count(*)::int`,
    })
    .from(staffTags)
    .innerJoin(staff, eq(staffTags.staffId, staff.id))
    .where(and(eq(staff.active, true), eq(staff.includeInBilling, true)))
    .groupBy(staffTags.tagId, staff.companyId);

  const out = new Map<number, Map<number, number>>();
  for (const r of rows) {
    let byCompany = out.get(r.tagId);
    if (!byCompany) out.set(r.tagId, (byCompany = new Map()));
    byCompany.set(r.companyId, r.count);
  }
  return out;
}

/**
 * The per-company quantities for every item: counted from the tag where one is
 * set, otherwise the manual allocations. Companies with no tagged people are
 * left out entirely rather than billed zero.
 */
export function resolveFixedAllocations(
  items: ItemLike[],
  manualAllocations: AllocLike[],
  headcounts: Map<number, Map<number, number>>,
): Map<number, ResolvedAllocation[]> {
  const out = new Map<number, ResolvedAllocation[]>();

  for (const item of items) {
    if (item.tagId !== null) {
      const byCompany = headcounts.get(item.tagId);
      out.set(
        item.id,
        byCompany
          ? [...byCompany.entries()]
              .filter(([, count]) => count > 0)
              .map(([companyId, count]) => ({ companyId, quantity: count, fromTag: true }))
          : [],
      );
    } else {
      out.set(
        item.id,
        manualAllocations
          .filter((a) => a.fixedLineItemId === item.id)
          .map((a) => ({ companyId: a.companyId, quantity: Number(a.quantity), fromTag: false })),
      );
    }
  }

  return out;
}

/** Both halves in one call, for the places that just want the answer. */
export async function loadFixedAllocations(
  items: ItemLike[],
  manualAllocations: AllocLike[],
): Promise<Map<number, ResolvedAllocation[]>> {
  // Only pay for the count query when something actually uses a tag.
  const needsCounts = items.some((i) => i.tagId !== null);
  const headcounts = needsCounts ? await tagHeadcounts() : new Map();
  return resolveFixedAllocations(items, manualAllocations, headcounts);
}

/* ------------------------------------------------------------------ */
/* Keeping the backing item in step with the tag                       */
/* ------------------------------------------------------------------ */

/**
 * Mirror a tag onto its fixed line item after the tag is created or edited.
 *
 * - a cost is set   → create or revive the item, matching name and price
 * - the cost is cleared → **deactivate** the item, never delete it
 *
 * Deleting would be the obvious move and it is wrong: `fixedLineItemId` is
 * `on delete set null` on expense account mappings, supplier splits and
 * creditor links, so a delete would silently unlink a mapped account and it
 * would go back to splitting the full amount with nothing to warn you.
 */
export async function syncTagLineItem(
  tagId: number,
  name: string,
  costPerPerson: number | null,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(fixedLineItems)
    .where(eq(fixedLineItems.tagId, tagId))
    .limit(1);

  if (costPerPerson === null) {
    if (existing && existing.active) {
      await db
        .update(fixedLineItems)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(fixedLineItems.id, existing.id));
    }
    return;
  }

  const amount = costPerPerson.toFixed(2);
  if (existing) {
    await db
      .update(fixedLineItems)
      .set({ name, unitAmount: amount, splitMode: "quantity", active: true, updatedAt: new Date() })
      .where(eq(fixedLineItems.id, existing.id));
  } else {
    await db.insert(fixedLineItems).values({
      name,
      tagId,
      splitMode: "quantity",
      unitAmount: amount,
      notes: "Billed per tagged team member.",
    });
  }
}

/** The costed tags, for screens that want to show what a tag is worth. */
export async function costedTags() {
  const rows = await db
    .select({ id: tags.id, name: tags.name, color: tags.color, cost: tags.costPerPerson })
    .from(tags);
  return rows.filter((r) => r.cost !== null);
}

/** Tag names by id, for labelling items that are tag-driven. */
export async function tagNames(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(inArray(tags.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
