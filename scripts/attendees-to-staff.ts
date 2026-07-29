/**
 * Repoints room_booking_attendees at `staff` instead of `users`.
 *
 * Most of the office is on the team list but has no login, so keying attendees
 * to users meant only the handful with accounts could be added to a meeting.
 * Safe to rebuild the table outright: it was empty (checked before running).
 *
 *   npx tsx scripts/attendees-to-staff.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  const existing = (await sql.query(
    `select count(*)::int as n from room_booking_attendees`,
  )) as { n: number }[];
  const count = existing[0]?.n ?? 0;
  if (count > 0) {
    console.error(`Refusing to run: ${count} attendee row(s) present. Migrate them by hand.`);
    process.exit(1);
  }

  await sql.query(`drop table if exists "room_booking_attendees"`);
  await sql.query(
    `create table "room_booking_attendees" (
       "booking_id" integer not null references "room_bookings"("id") on delete cascade,
       "staff_id" integer not null references "staff"("id") on delete cascade,
       primary key ("booking_id", "staff_id")
     )`,
  );
  console.log("OK room_booking_attendees now keyed on staff_id");

  const cols = (await sql.query(
    `select column_name from information_schema.columns
      where table_name = 'room_booking_attendees' order by column_name`,
  )) as { column_name: string }[];
  console.log(`Columns: ${cols.map((c) => c.column_name).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
