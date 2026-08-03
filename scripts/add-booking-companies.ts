/**
 * Creates room_booking_companies — which sub-companies a meeting is for.
 * Additive only: a new table, nothing existing is touched.
 *
 *   npx tsx scripts/add-booking-companies.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(
    `create table if not exists "room_booking_companies" (
       "booking_id" integer not null references "room_bookings"("id") on delete cascade,
       "company_id" integer not null references "companies"("id") on delete cascade,
       constraint "room_booking_companies_booking_id_company_id_pk"
         primary key ("booking_id", "company_id")
     )`,
  );
  console.log("OK room_booking_companies");

  const cols = (await sql.query(
    `select column_name, data_type from information_schema.columns
      where table_name = 'room_booking_companies' order by ordinal_position`,
  )) as { column_name: string; data_type: string }[];
  console.log(`Columns: ${cols.map((c) => `${c.column_name} ${c.data_type}`).join(", ")}`);

  const [{ n }] = (await sql.query(
    `select count(*)::int as n from room_booking_companies`,
  )) as { n: number }[];
  console.log(`Rows: ${n}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
