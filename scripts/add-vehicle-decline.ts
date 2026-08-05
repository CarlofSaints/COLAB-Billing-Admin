/**
 * Lets whoever looks after the fleet decline somebody else's booking, with a
 * reason the booker actually sees.
 *
 *   npx tsx scripts/add-vehicle-decline.ts
 *
 * Declining is NOT stealing (that hands the slot to the asker) and NOT the
 * "booked by mistake" delete (that removes the row and the booker's own act).
 * It's a refusal by the fleet, so it keeps the record — who declined it, when,
 * and why — while freeing the vehicle.
 *
 * ⚠️ THE EXCLUSION CONSTRAINT HAS TO LEARN ABOUT IT. It currently reserves the
 * window for any row with `returned_at is null`, so a declined booking would go
 * on blocking the vehicle it just released. The predicate gains
 * `and declined_at is null`.
 *
 * Safe to run twice.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);
const CONSTRAINT = "vehicle_bookings_no_overlap";

async function main() {
  // ALTER TYPE ... ADD VALUE can't run inside a transaction; the neon http
  // driver autocommits each statement, so this is fine as written.
  await sql.query(
    `alter type "vehicle_booking_status" add value if not exists 'declined'`,
  );
  console.log("OK status 'declined'");

  await sql.query(
    `alter table "vehicle_bookings"
       add column if not exists "declined_at" timestamp with time zone,
       add column if not exists "declined_reason" text,
       add column if not exists "declined_by_user_id" integer references "users"("id") on delete set null,
       add column if not exists "declined_by_name" text`,
  );
  console.log("OK decline columns");

  // Nothing is declined yet, so the new predicate can only ever free rows —
  // but check rather than assume, because rebuilding an exclusion constraint on
  // data that violates it fails with a raw Postgres error.
  const clashes = (await sql.query(
    `select a.id as a_id, b.id as b_id
       from "vehicle_bookings" a
       join "vehicle_bookings" b
         on b.vehicle_id = a.vehicle_id and b.id > a.id
        and a.returned_at is null and a.declined_at is null
        and b.returned_at is null and b.declined_at is null
        and tstzrange(a.taken_out_at, a.expected_return_at, '[)')
         && tstzrange(b.taken_out_at, b.expected_return_at, '[)')`,
  )) as { a_id: number; b_id: number }[];

  if (clashes.length > 0) {
    console.error(`✗ ${clashes.length} pair(s) of live bookings overlap — sort those out first:`);
    for (const c of clashes) console.error(`   booking ${c.a_id} vs ${c.b_id}`);
    process.exit(1);
  }
  console.log("OK no live bookings overlap");

  await sql.query(`alter table "vehicle_bookings" drop constraint if exists "${CONSTRAINT}"`);
  await sql.query(
    `alter table "vehicle_bookings"
       add constraint "${CONSTRAINT}"
       exclude using gist (
         "vehicle_id" with =,
         tstzrange("taken_out_at", "expected_return_at", '[)') with &&
       ) where ("returned_at" is null and "declined_at" is null)`,
  );
  console.log(`OK ${CONSTRAINT} now ignores declined bookings`);

  /* --- prove a declined booking releases its window ------------------- */

  const [v] = (await sql.query(`select id, name from "vehicles" order by id limit 1`)) as {
    id: number;
    name: string;
  }[];
  if (!v) {
    console.log("\n(no vehicles to test against)");
    return;
  }

  const probe = "decline-probe@example.invalid";
  await sql.query(`delete from "vehicle_bookings" where booked_by_email = $1`, [probe]);

  const [first] = (await sql.query(
    `insert into "vehicle_bookings"
       ("vehicle_id","booked_by_name","booked_by_email","taken_out_at","expected_return_at","status")
     values ($1,'Probe A',$2, now() + interval '30 days', now() + interval '30 days 4 hours','out')
     returning id`,
    [v.id, probe],
  )) as { id: number }[];

  let blockedBefore = false;
  try {
    await sql.query(
      `insert into "vehicle_bookings"
         ("vehicle_id","booked_by_name","booked_by_email","taken_out_at","expected_return_at","status")
       values ($1,'Probe B',$2, now() + interval '30 days 1 hour', now() + interval '30 days 3 hours','out')`,
      [v.id, probe],
    );
  } catch {
    blockedBefore = true;
  }

  await sql.query(
    `update "vehicle_bookings"
        set status = 'declined', declined_at = now(), declined_reason = 'probe',
            declined_by_name = 'Probe'
      where id = $1`,
    [first.id],
  );

  let allowedAfter = true;
  try {
    await sql.query(
      `insert into "vehicle_bookings"
         ("vehicle_id","booked_by_name","booked_by_email","taken_out_at","expected_return_at","status")
       values ($1,'Probe C',$2, now() + interval '30 days 1 hour', now() + interval '30 days 3 hours','out')`,
      [v.id, probe],
    );
  } catch {
    allowedAfter = false;
  }

  const cleaned = (await sql.query(
    `delete from "vehicle_bookings" where booked_by_email = $1 returning id`,
    [probe],
  )) as { id: number }[];

  console.log("");
  console.log(`${blockedBefore ? "OK  " : "✗   "}the window is reserved while the booking stands`);
  console.log(`${allowedAfter ? "OK  " : "✗   "}declining it releases the window`);
  console.log(`Cleaned up ${cleaned.length} probe row(s)`);

  const [{ total }] = (await sql.query(
    `select count(*)::int as total from "vehicle_bookings"`,
  )) as { total: number }[];
  console.log(`${total} real booking(s) untouched`);

  if (!blockedBefore || !allowedAfter) process.exit(1);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
