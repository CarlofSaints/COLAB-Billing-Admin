/**
 * Adds the two "when did we last nag this person" columns behind Profile
 * Nudges. Purely additive — two nullable timestamps, nothing existing touched
 * — and written out by hand rather than left to `drizzle-kit push`, which
 * diffs the whole schema and will happily propose a drop if the live database
 * has drifted.
 *
 *   npx tsx scripts/add-nudge-columns.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

const statements: [string, string][] = [
  [
    "users.last_login_nudge_at",
    `alter table "users" add column if not exists "last_login_nudge_at" timestamptz`,
  ],
  [
    "staff.last_profile_nudge_at",
    `alter table "staff" add column if not exists "last_profile_nudge_at" timestamptz`,
  ],
];

async function main() {
  for (const [label, statement] of statements) {
    await sql.query(statement);
    console.log(`✓ ${label}`);
  }

  const rows = (await sql.query(
    `select table_name, column_name from information_schema.columns
      where (table_name = 'users' and column_name = 'last_login_nudge_at')
         or (table_name = 'staff' and column_name = 'last_profile_nudge_at')`,
  )) as { table_name: string; column_name: string }[];
  console.log(
    `\n${rows.length === 2 ? "✓ Both columns present." : `⚠ Expected 2 columns, found ${rows.length}.`}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
