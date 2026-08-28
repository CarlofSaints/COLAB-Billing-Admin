/**
 * Removes the "Yaxxa Voice Usage" fixed line item — a hand-typed R650 monthly
 * average (its own note said "should be reconned every 3 months") that stood in
 * for Yaxxa's real call usage while no rule could bill a variable balance.
 *
 * With multi-item recovery in place the July Yaxxa line recovers VOIP +
 * Handset + Fibre&MW and splits the actual balance per head — R1 507,49 for
 * July — so the average is now a straight double-charge on top of it.
 *
 * Mirrors `deleteFixedItem` in src/app/actions/controls.ts: refuses a
 * tag-owned item, strips the id from every recovery rule, and writes the same
 * activity-log line. Done as a script because the in-app delete goes through a
 * browser confirm() dialog.
 *
 * Dry-run by default.
 *   npx tsx scripts/remove-yaxxa-voice-usage.ts
 *   npx tsx scripts/remove-yaxxa-voice-usage.ts --apply
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);
const apply = process.argv.includes("--apply");
const ITEM_NAME = "Yaxxa Voice Usage";

async function main() {
  console.log(apply ? "APPLYING\n" : "DRY RUN — pass --apply to write\n");

  const [item] = (await sql`select id, name, unit_amount, split_mode, tag_id, active
                              from fixed_line_items where name = ${ITEM_NAME}`) as {
    id: number; name: string; unit_amount: string; split_mode: string; tag_id: number | null; active: boolean;
  }[];

  if (!item) {
    console.log(`No item called "${ITEM_NAME}" — nothing to do.`);
    return;
  }
  console.log(`Found #${item.id} "${item.name}" — R${item.unit_amount}, ${item.split_mode}, active=${item.active}`);

  // Same guard as the action: a tag owns its item, and it is stood down by
  // clearing the tag's cost, not deleted from under the tag.
  if (item.tag_id != null) {
    console.log("⚠ This item is owned by a tag — clear the tag's cost instead. Aborting.");
    return;
  }

  // Anything still naming it would lose its deduction, so report before acting.
  for (const table of ["expense_account_mappings", "supplier_splits", "creditor_links"]) {
    const rows = (await sql.query(
      `select id from ${table} where fixed_line_item_ids @> to_jsonb(array[${item.id}::int])
          or fixed_line_item_id = ${item.id}`,
    )) as { id: number }[];
    console.log(`  ${table}: ${rows.length} rule(s) name it${rows.length ? ` (#${rows.map((r) => r.id).join(", #")})` : ""}`);
  }

  const allocs = (await sql`select count(*)::int n from fixed_line_allocations
                             where fixed_line_item_id = ${item.id}`) as { n: number }[];
  console.log(`  fixed_line_allocations: ${allocs[0].n} row(s) (cascade)`);

  if (!apply) return;

  await sql`delete from fixed_line_items where id = ${item.id}`;
  for (const table of ["expense_account_mappings", "supplier_splits", "creditor_links"]) {
    await sql.query(
      `update ${table}
          set fixed_line_item_ids = coalesce(
                (select jsonb_agg(e) from jsonb_array_elements(fixed_line_item_ids) e
                  where e <> to_jsonb(${item.id}::int)), '[]'::jsonb)
        where fixed_line_item_ids @> to_jsonb(array[${item.id}::int])`,
    );
  }

  await sql`insert into activity_log (action, summary, actor_label, entity_type, entity_id)
            values ('controls.fixed_delete',
                    ${`Removed the fixed line item "${item.name}" — replaced by the Yaxxa balance split`},
                    'Claude (script)', 'fixed_line_item', ${item.id})`;

  const [gone] = (await sql`select count(*)::int n from fixed_line_items where id = ${item.id}`) as { n: number }[];
  console.log(`\n✓ Deleted. Rows remaining with that id: ${gone.n}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
