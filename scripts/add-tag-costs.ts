/**
 * Adds the costed-tag columns. Purely additive — two nullable columns and one
 * partial unique index, no data touched — and written out by hand rather than
 * left to `drizzle-kit push`, which diffs the whole schema and will happily
 * propose a drop if the live database has drifted.
 *
 *   npx tsx scripts/add-tag-costs.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

const statements: [string, string][] = [
  [
    "tags.cost_per_person",
    `alter table "tags" add column if not exists "cost_per_person" numeric(12, 2)`,
  ],
  [
    "fixed_line_items.tag_id",
    `alter table "fixed_line_items" add column if not exists "tag_id" integer
       references "tags"("id") on delete set null`,
  ],
  [
    "fixed_item_tag_unique",
    `create unique index if not exists "fixed_item_tag_unique"
       on "fixed_line_items" ("tag_id") where "tag_id" is not null`,
  ],
];

async function main() {
  for (const [label, statement] of statements) {
    await sql.query(statement);
    console.log(`✓ ${label}`);
  }

  const rows = (await sql.query(
    `select count(*)::int as count from information_schema.columns
      where table_name in ('tags', 'fixed_line_items')
        and column_name in ('cost_per_person', 'tag_id')`,
  )) as { count: number }[];
  const count = rows[0]?.count ?? 0;
  console.log(
    `\n${count === 2 ? "✓ Both columns present." : `⚠ Expected 2 columns, found ${count}.`}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
