/**
 * Lets a vehicle be booked for a future slot, and lets somebody ask for a slot
 * that's already taken.
 *
 *   npx tsx scripts/add-vehicle-steal.ts
 *
 * Two changes, both safe to run twice:
 *
 * 1. The old rule — one un-returned booking per vehicle, enforced by a partial
 *    UNIQUE index — is replaced by an EXCLUSION constraint over the booked
 *    window. The old one made "book it for next Tuesday" impossible while the
 *    car was out today, which is exactly what's now wanted.
 *
 *    ⚠️ TWO THINGS ABOUT THE NEW CONSTRAINT ARE LOAD-BEARING:
 *      - it ranges over taken_out_at → expected_return_at, the DECLARED window,
 *        and never over returned_at. If the occupied range grew when someone
 *        came back late, the UPDATE that signs the vehicle in would itself be
 *        refused whenever the next booking had already begun. Being late must
 *        not make a vehicle un-returnable.
 *      - `where (returned_at is null)` is what lets a vehicle brought back
 *        early be re-booked inside its original window.
 *
 * 2. `vehicle_steal_requests`, which carries the window being asked for as well
 *    as the booking being asked about — unlike a room steal, the asker often
 *    wants only part of the holder's window.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

const CONSTRAINT = "vehicle_bookings_no_overlap";

async function main() {
  // The `vehicle_id with =` half of the exclusion needs btree operators inside
  // a gist index, which is what this extension provides.
  await sql.query(`create extension if not exists btree_gist`);
  console.log("OK extension btree_gist");

  // Before swapping the rule, check nothing currently on record would violate
  // the new one — adding the constraint would fail anyway, but it would fail
  // with a raw Postgres error rather than a list of the offending trips.
  const clashes = (await sql.query(
    `select a.id as a_id, b.id as b_id, v.name as vehicle
       from "vehicle_bookings" a
       join "vehicle_bookings" b
         on b.vehicle_id = a.vehicle_id and b.id > a.id
        and a.returned_at is null and b.returned_at is null
        and tstzrange(a.taken_out_at, a.expected_return_at, '[)')
         && tstzrange(b.taken_out_at, b.expected_return_at, '[)')
       join "vehicles" v on v.id = a.vehicle_id`,
  )) as { a_id: number; b_id: number; vehicle: string }[];

  if (clashes.length > 0) {
    console.error(`✗ ${clashes.length} pair(s) of existing bookings already overlap:`);
    for (const c of clashes) console.error(`   ${c.vehicle}: booking ${c.a_id} vs ${c.b_id}`);
    console.error("  Sort those out before adding the constraint.");
    process.exit(1);
  }
  console.log("OK no existing bookings overlap");

  await sql.query(`drop index if exists "vehicle_bookings_one_out_per_vehicle"`);
  console.log("OK dropped the one-open-trip-per-vehicle index");

  await sql.query(
    `create index if not exists "vehicle_bookings_window_idx"
       on "vehicle_bookings" ("vehicle_id", "taken_out_at", "expected_return_at")`,
  );

  // add constraint has no `if not exists`, so this is the idempotent form.
  await sql.query(`alter table "vehicle_bookings" drop constraint if exists "${CONSTRAINT}"`);
  await sql.query(
    `alter table "vehicle_bookings"
       add constraint "${CONSTRAINT}"
       exclude using gist (
         "vehicle_id" with =,
         tstzrange("taken_out_at", "expected_return_at", '[)') with &&
       ) where ("returned_at" is null)`,
  );
  console.log(`OK constraint ${CONSTRAINT}`);

  await sql.query(
    `create table if not exists "vehicle_steal_requests" (
       "id" serial primary key,
       "booking_id" integer not null references "vehicle_bookings"("id") on delete cascade,
       "requester_user_id" integer references "users"("id") on delete set null,
       "requester_name" text not null,
       "requester_email" text not null,
       "message" text not null,
       "requested_from" timestamp with time zone not null,
       "requested_to" timestamp with time zone not null,
       "requested_for_user_id" integer references "users"("id") on delete set null,
       "requested_for_name" text,
       "requested_for_email" text,
       "for_service" boolean not null default false,
       "status" "steal_status" not null default 'pending',
       "decline_reason" text,
       "token" text not null,
       "responded_at" timestamp with time zone,
       "created_at" timestamp with time zone not null default now()
     )`,
  );
  await sql.query(
    `create unique index if not exists "vehicle_steal_token_unique"
       on "vehicle_steal_requests" ("token")`,
  );
  await sql.query(
    `create index if not exists "vehicle_steal_booking_idx"
       on "vehicle_steal_requests" ("booking_id")`,
  );
  console.log("OK vehicle_steal_requests");

  /* --- prove the constraint actually bites ---------------------------- */

  const [v] = (await sql.query(`select id, name from "vehicles" order by id limit 1`)) as {
    id: number;
    name: string;
  }[];
  if (!v) {
    console.log("\n(no vehicles to test the constraint against)");
    return;
  }

  const probe = "constraint-probe@example.invalid";
  await sql.query(`delete from "vehicle_bookings" where booked_by_email = $1`, [probe]);

  await sql.query(
    `insert into "vehicle_bookings"
       ("vehicle_id","booked_by_name","booked_by_email","taken_out_at","expected_return_at","status")
     values ($1,'Probe A',$2, now() + interval '2 days', now() + interval '2 days 4 hours','out')`,
    [v.id, probe],
  );

  let overlapBlocked = false;
  try {
    await sql.query(
      `insert into "vehicle_bookings"
         ("vehicle_id","booked_by_name","booked_by_email","taken_out_at","expected_return_at","status")
       values ($1,'Probe B',$2, now() + interval '2 days 2 hours', now() + interval '2 days 6 hours','out')`,
      [v.id, probe],
    );
  } catch {
    overlapBlocked = true;
  }

  let adjacentAllowed = true;
  try {
    await sql.query(
      `insert into "vehicle_bookings"
         ("vehicle_id","booked_by_name","booked_by_email","taken_out_at","expected_return_at","status")
       values ($1,'Probe C',$2, now() + interval '2 days 4 hours', now() + interval '2 days 8 hours','out')`,
      [v.id, probe],
    );
  } catch {
    adjacentAllowed = false;
  }

  // The whole point of the change: a second, non-overlapping FUTURE booking on
  // a vehicle that is already spoken for.
  let futureAllowed = true;
  try {
    await sql.query(
      `insert into "vehicle_bookings"
         ("vehicle_id","booked_by_name","booked_by_email","taken_out_at","expected_return_at","status")
       values ($1,'Probe D',$2, now() + interval '9 days', now() + interval '9 days 3 hours','out')`,
      [v.id, probe],
    );
  } catch {
    futureAllowed = false;
  }

  const cleaned = (await sql.query(
    `delete from "vehicle_bookings" where booked_by_email = $1 returning id`,
    [probe],
  )) as { id: number }[];

  console.log("");
  console.log(`${overlapBlocked ? "OK  " : "✗   "}an overlapping booking is refused`);
  console.log(`${adjacentAllowed ? "OK  " : "✗   "}a back-to-back booking is allowed`);
  console.log(`${futureAllowed ? "OK  " : "✗   "}a separate future booking is allowed`);
  console.log(`Cleaned up ${cleaned.length} probe row(s)`);

  if (!overlapBlocked || !adjacentAllowed || !futureAllowed) process.exit(1);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
