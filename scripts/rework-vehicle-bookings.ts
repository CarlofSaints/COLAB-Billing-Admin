/**
 * Reshapes vehicle bookings around the flow the team actually wants.
 *
 *   npx tsx scripts/rework-vehicle-bookings.ts
 *
 * Signing a vehicle out now asks only for times. Every reading — opening AND
 * closing mileage, opening AND closing fuel — is taken at the return, along
 * with notes and what was spent on fuel. The one-time email code is gone.
 *
 * ⚠️ THIS DROPS COLUMNS. It refuses to run if there is a single booking on
 * record, because on a populated table the OTP columns and the NOT NULL on
 * `opening_fuel` would need migrating rather than removing. Checked at the top
 * so the refusal happens before anything is altered, not halfway through.
 *
 * Safe to run twice: every statement is `if exists` / `if not exists`, and the
 * emptiness check is what makes the destructive half defensible.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

/** The OTP is gone; so are the columns that only ever existed to serve it. */
const OTP_COLUMNS = [
  "pending_closing_mileage",
  "pending_closing_fuel",
  "return_otp_hash",
  "return_otp_expires_at",
  "return_otp_sent_at",
  "return_otp_attempts",
  "return_otp_user_id",
];

async function main() {
  const [{ n }] = (await sql.query(
    `select count(*)::int as n from "vehicle_bookings"`,
  )) as { n: number }[];

  if (n > 0) {
    console.error(
      `✗ There are ${n} vehicle booking(s) on record.\n` +
        `  This script drops columns and tightens a NOT NULL, which is only safe on an\n` +
        `  empty table. Migrate the existing rows first, or clear them deliberately.`,
    );
    process.exit(1);
  }
  console.log("OK vehicle_bookings is empty — safe to reshape");

  // The enum first: the column that uses it can't be added before it exists.
  await sql.query(
    `do $$ begin
       create type "vehicle_refuel_payer" as enum ('own_money','company_card');
     exception when duplicate_object then null; end $$`,
  );
  console.log("OK type vehicle_refuel_payer");

  // Times. `expected_return_at` is NOT NULL with no default on purpose — the
  // overdue reminder has nothing to fire against without it, and a default would
  // invent a deadline nobody agreed to. The table is empty, so no backfill.
  await sql.query(
    `alter table "vehicle_bookings"
       add column if not exists "expected_return_at" timestamp with time zone not null`,
  );
  await sql.query(
    `alter table "vehicle_bookings"
       add column if not exists "overdue_reminded_at" timestamp with time zone`,
  );
  console.log("OK expected_return_at, overdue_reminded_at");

  // Every reading is now taken at the return, so opening_fuel joins the other
  // three in being null while the trip is open.
  await sql.query(`alter table "vehicle_bookings" alter column "opening_fuel" drop not null`);
  console.log("OK opening_fuel is nullable");

  await sql.query(
    `alter table "vehicle_bookings"
       add column if not exists "refuelled" boolean not null default false,
       add column if not exists "refuel_paid_by" "vehicle_refuel_payer",
       add column if not exists "refuel_amount" numeric(12,2),
       add column if not exists "refuel_receipt_path" text,
       add column if not exists "refuel_receipt_content_type" text`,
  );
  console.log("OK refuel columns");

  for (const col of OTP_COLUMNS) {
    await sql.query(`alter table "vehicle_bookings" drop column if exists "${col}"`);
  }
  console.log(`OK dropped ${OTP_COLUMNS.length} one-time-code column(s)`);

  // Read the shape back rather than trusting the statements above: an
  // `add column if not exists` against a column that already existed with the
  // wrong type is a silent no-op.
  const cols = (await sql.query(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_name = 'vehicle_bookings'
      order by ordinal_position`,
  )) as { column_name: string; data_type: string; is_nullable: string }[];

  console.log("\nvehicle_bookings is now:");
  for (const c of cols) {
    console.log(`   ${c.column_name.padEnd(28)} ${c.data_type} ${c.is_nullable === "YES" ? "" : "not null"}`);
  }

  const names = new Set(cols.map((c) => c.column_name));
  const missing = [
    "expected_return_at",
    "overdue_reminded_at",
    "refuelled",
    "refuel_paid_by",
    "refuel_amount",
    "refuel_receipt_path",
    "refuel_receipt_content_type",
  ].filter((c) => !names.has(c));
  const leftover = OTP_COLUMNS.filter((c) => names.has(c));
  const openingFuel = cols.find((c) => c.column_name === "opening_fuel");

  if (missing.length || leftover.length || openingFuel?.is_nullable !== "YES") {
    console.error(
      `\n✗ Not in the expected shape — missing [${missing.join(", ")}], ` +
        `leftover [${leftover.join(", ")}], opening_fuel nullable ${openingFuel?.is_nullable}`,
    );
    process.exit(1);
  }

  // The rule that survives two people clicking Book at the same second. It was
  // created with the table; assert it's still there rather than assume.
  const idx = (await sql.query(
    `select indexname from pg_indexes
      where tablename = 'vehicle_bookings'
        and indexname = 'vehicle_bookings_one_out_per_vehicle'`,
  )) as { indexname: string }[];
  console.log(
    idx.length
      ? "\nOK one-open-trip-per-vehicle index still in place"
      : "\n✗ one-open-trip-per-vehicle index is MISSING",
  );
  if (!idx.length) process.exit(1);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
