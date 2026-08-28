import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Housekeeping for the `fixed_line_item_ids` arrays that say which Static
 * items a recharge rule recovers before splitting the balance.
 *
 * These are jsonb, so unlike the old single `fixed_line_item_id` column there
 * is NO foreign key tidying up behind a deleted item. An id left pointing at
 * nothing recovers nothing, which makes the balance too big and OVER-charges
 * the sub-companies — the expensive direction. The engine warns when it sees
 * one, but the real fix is to never leave one behind.
 *
 * ⚠️ Not exported from a `"use server"` module on purpose: every export of one
 * of those is a public POST endpoint, and this writes to billing rules.
 */

/** The three tables that carry a recovery rule. */
const TABLES = ["expense_account_mappings", "supplier_splits", "creditor_links"] as const;

/**
 * Removes one fixed line item from every rule that names it. Call this
 * whenever an item is deleted.
 *
 * Returns how many rows changed, so the caller can log it.
 */
export async function forgetRecoveryItem(itemId: number): Promise<number> {
  if (!Number.isInteger(itemId) || itemId <= 0) return 0;
  let changed = 0;

  for (const table of TABLES) {
    // `jsonb_agg` over an empty set is NULL, not '[]' — without the coalesce a
    // rule whose only item was this one would end up NULL and blow past the
    // not-null constraint.
    const result = await db.execute(sql`
      update ${sql.raw(table)}
         set fixed_line_item_ids = coalesce(
               (select jsonb_agg(e)
                  from jsonb_array_elements(fixed_line_item_ids) e
                 where e <> to_jsonb(${itemId}::int)),
               '[]'::jsonb)
       where fixed_line_item_ids @> to_jsonb(array[${itemId}::int])
      returning id
    `);
    changed += Array.isArray(result) ? result.length : (result.rows?.length ?? 0);
  }

  return changed;
}
