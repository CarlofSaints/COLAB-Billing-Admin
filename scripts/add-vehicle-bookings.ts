/**
 * Creates the vehicle_bookings table and the staff cross-company flag.
 * Additive only: one new column with a default, one new table, two new enums.
 *
 *   npx tsx scripts/add-vehicle-bookings.ts
 *
 * Written by hand rather than run through `db:push`, which is interactive
 * (strict mode, no migrations dir) and therefore hangs in an agent shell.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

const statements: [string, string][] = [
  [
    // `create type` has no IF NOT EXISTS, so re-running would otherwise fail on
    // an already-migrated database. A DO block makes the script idempotent.
    "vehicle_fuel_level enum",
    `do $$ begin
       create type "vehicle_fuel_level" as enum
         ('full', 'three_quarters', 'half', 'quarter', 'under_quarter');
     exception when duplicate_object then null; end $$`,
  ],
  [
    "vehicle_booking_status enum",
    `do $$ begin
       create type "vehicle_booking_status" as enum ('out', 'home', 'servicing');
     exception when duplicate_object then null; end $$`,
  ],
  [
    // Default false: nobody gains the right to another company's vehicles by
    // this script running.
    "staff.can_book_other_company_vehicles",
    `alter table "staff"
       add column if not exists "can_book_other_company_vehicles"
       boolean not null default false`,
  ],
  [
    "vehicle_bookings",
    `create table if not exists "vehicle_bookings" (
       "id" serial primary key,
       "vehicle_id" integer not null references "vehicles"("id") on delete restrict,
       "booked_by_user_id" integer references "users"("id") on delete set null,
       "booked_by_name" text not null,
       "booked_by_email" text not null,
       "booked_for_user_id" integer references "users"("id") on delete set null,
       "booked_for_name" text,
       "booked_for_email" text,
       "opening_mileage" integer not null,
       "closing_mileage" integer,
       "opening_fuel" "vehicle_fuel_level" not null,
       "closing_fuel" "vehicle_fuel_level",
       "status" "vehicle_booking_status" not null default 'out',
       "notes" text,
       "taken_out_at" timestamp with time zone not null default now(),
       "returned_at" timestamp with time zone,
       "pending_closing_mileage" integer,
       "pending_closing_fuel" "vehicle_fuel_level",
       "return_otp_hash" text,
       "return_otp_expires_at" timestamp with time zone,
       "return_otp_sent_at" timestamp with time zone,
       "return_otp_attempts" integer not null default 0,
       "return_otp_user_id" integer references "users"("id") on delete set null,
       "created_at" timestamp with time zone not null default now(),
       "updated_at" timestamp with time zone not null default now()
     )`,
  ],
  [
    "vehicle_bookings_vehicle_idx",
    `create index if not exists "vehicle_bookings_vehicle_idx"
       on "vehicle_bookings" ("vehicle_id")`,
  ],
  [
    "vehicle_bookings_status_idx",
    `create index if not exists "vehicle_bookings_status_idx"
       on "vehicle_bookings" ("status")`,
  ],
  [
    // A vehicle is in one place at a time. The action checks this too so the
    // error can name who has the car — but two people clicking Book in the same
    // second is exactly what an application-level check misses.
    "vehicle_bookings_one_out_per_vehicle",
    `create unique index if not exists "vehicle_bookings_one_out_per_vehicle"
       on "vehicle_bookings" ("vehicle_id") where "status" <> 'home'`,
  ],
];

async function main() {
  for (const [label, statement] of statements) {
    await sql.query(statement);
    console.log(`OK ${label}`);
  }

  const cols = (await sql.query(
    `select column_name, data_type, is_nullable from information_schema.columns
      where table_name = 'vehicle_bookings' order by ordinal_position`,
  )) as { column_name: string; data_type: string; is_nullable: string }[];
  console.log(`\nvehicle_bookings columns:`);
  for (const c of cols) {
    console.log(`  ${c.column_name} ${c.data_type}${c.is_nullable === "NO" ? " not null" : ""}`);
  }

  const idx = (await sql.query(
    `select indexname from pg_indexes where tablename = 'vehicle_bookings' order by indexname`,
  )) as { indexname: string }[];
  console.log(`Indexes: ${idx.map((i) => i.indexname).join(", ")}`);

  const flag = (await sql.query(
    `select column_name, data_type, column_default from information_schema.columns
      where table_name = 'staff' and column_name = 'can_book_other_company_vehicles'`,
  )) as { column_name: string; data_type: string; column_default: string }[];
  console.log(
    `\nstaff flag: ${flag.length ? `${flag[0].column_name} ${flag[0].data_type} default ${flag[0].column_default}` : "MISSING"}`,
  );

  const granted = (await sql.query(
    `select count(*)::int as n from "staff" where "can_book_other_company_vehicles" = true`,
  )) as { n: number }[];
  console.log(`Team members allowed to book other companies' vehicles: ${granted[0].n}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
