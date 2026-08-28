/**
 * A recharge rule could name exactly ONE fixed line item to recover before
 * splitting the balance. A single supplier bill is routinely pre-billed by
 * several (Yaxxa: VOIP handsets by tag, licences by tag, Fibre&MW per head),
 * so one id meant the balance was overstated by every item you couldn't name.
 *
 * Adds `fixed_line_item_ids` (a jsonb array of ids) to the three tables that
 * carry a recovery rule, and backfills it from the single id already there.
 * The old `fixed_line_item_id` column is LEFT IN PLACE and still read as a
 * fallback, so a row this script somehow misses keeps working.
 *
 * Also drops `not null` from `creditor_links.fixed_line_item_id` — the array
 * is the source of truth now, and a link naming three items has no single id
 * to put there.
 *
 * Idempotent: safe to run twice. Dry-run by default.
 *
 *   npx tsx scripts/add-multi-item-recovery.ts          # show what would change
 *   npx tsx scripts/add-multi-item-recovery.ts --apply  # do it
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);
const apply = process.argv.includes("--apply");

const TABLES = ["expense_account_mappings", "supplier_splits", "creditor_links"] as const;

async function main() {
  console.log(apply ? "APPLYING\n" : "DRY RUN — pass --apply to write\n");

  for (const table of TABLES) {
    const pending = (await sql.query(
      `select count(*)::int as n from ${table} where fixed_line_item_id is not null`,
    )) as { n: number }[];
    console.log(`${table}: ${pending[0].n} row(s) carry a single item id`);

    if (!apply) continue;

    await sql.query(
      `alter table ${table}
         add column if not exists fixed_line_item_ids jsonb not null default '[]'::jsonb`,
    );
    // Only fills rows that have nothing yet, so re-running never clobbers a
    // multi-item rule someone has since saved.
    const filled = (await sql.query(
      `update ${table}
          set fixed_line_item_ids = to_jsonb(array[fixed_line_item_id])
        where fixed_line_item_id is not null
          and (fixed_line_item_ids is null or fixed_line_item_ids = '[]'::jsonb)
        returning id`,
    )) as { id: number }[];
    console.log(`  ✓ column present, ${filled.length} row(s) backfilled`);
  }

  if (apply) {
    await sql.query(
      `alter table creditor_links alter column fixed_line_item_id drop not null`,
    );
    console.log("\n✓ creditor_links.fixed_line_item_id is now nullable");
  }

  console.log("\n--- state ---");
  for (const table of TABLES) {
    const rows = (await sql.query(
      `select id, fixed_line_item_id, fixed_line_item_ids from ${table}
        where fixed_line_item_id is not null
           or (fixed_line_item_ids is not null and fixed_line_item_ids <> '[]'::jsonb)
        order by id`,
    ).catch(() => [])) as { id: number; fixed_line_item_id: number | null; fixed_line_item_ids: unknown }[];
    for (const r of rows) {
      console.log(
        `  ${table} #${r.id}: single=${r.fixed_line_item_id ?? "—"} ids=${JSON.stringify(r.fixed_line_item_ids)}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
