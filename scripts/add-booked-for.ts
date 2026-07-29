/**
 * Adds the "booked on behalf of" columns to room_bookings. Additive only.
 *
 *   npx tsx scripts/add-booked-for.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

const statements: [string, string][] = [
  [
    "booked_for_user_id",
    `alter table "room_bookings" add column if not exists "booked_for_user_id" integer
       references "users"("id") on delete set null`,
  ],
  [
    "booked_for_name",
    `alter table "room_bookings" add column if not exists "booked_for_name" text`,
  ],
  [
    "booked_for_email",
    `alter table "room_bookings" add column if not exists "booked_for_email" text`,
  ],
];

async function main() {
  for (const [label, statement] of statements) {
    await sql.query(statement);
    console.log(`OK ${label}`);
  }
  const rows = (await sql.query(
    `select column_name from information_schema.columns
      where table_name = 'room_bookings' and column_name like 'booked_for%'
      order by column_name`,
  )) as { column_name: string }[];
  console.log(`\nPresent: ${rows.map((r) => r.column_name).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
