/**
 * Adds the column that gates the "you're on the front desk shortly" nudge.
 *
 * Additive and idempotent — one nullable column. Applied by hand rather than
 * with `drizzle-kit push --force`, which diffs the whole schema and can
 * propose drops on drift.
 *
 *   npx tsx scripts/add-reception-reminders.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(
    `alter table "reception_slots"
       add column if not exists "reminder_sent_at" timestamptz`,
  );
  console.log("OK reception_slots.reminder_sent_at");

  const [row] = (await sql.query(
    `select count(*)::int as total,
            count(reminder_sent_at)::int as reminded
       from reception_slots`,
  )) as { total: number; reminded: number }[];
  console.log(`reception_slots: ${row.total} row(s), ${row.reminded} already reminded`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
