/**
 * Makes odometer readings optional per vehicle.
 *
 *   npx tsx scripts/add-vehicle-mileage-optional.ts
 *
 * Two additive changes, both safe to run twice:
 *   1. `vehicles.mileage_required` — defaults TRUE, so every vehicle already in
 *      the register keeps behaving exactly as it does today. Only a vehicle
 *      someone deliberately unticks changes.
 *   2. `vehicle_bookings.opening_mileage` loses its NOT NULL. Nothing is
 *      backfilled and nothing existing becomes null — this only makes room for
 *      bookings of a vehicle whose readings have been switched off.
 *
 * `db:push` is interactive in this repo (strict, no migrations dir), so it hangs
 * in a non-interactive shell. The exact SQL is run here instead.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(
    `alter table "vehicles"
       add column if not exists "mileage_required" boolean not null default true`,
  );
  console.log("OK vehicles.mileage_required");

  await sql.query(`alter table "vehicle_bookings" alter column "opening_mileage" drop not null`);
  console.log("OK vehicle_bookings.opening_mileage is nullable");

  // Read it back from the catalogue rather than trusting the statements above —
  // a column that already existed with the wrong nullability would have made
  // "add column if not exists" a silent no-op.
  const cols = (await sql.query(
    `select table_name, column_name, is_nullable, column_default
       from information_schema.columns
      where (table_name = 'vehicles' and column_name = 'mileage_required')
         or (table_name = 'vehicle_bookings' and column_name = 'opening_mileage')
      order by table_name`,
  )) as { table_name: string; column_name: string; is_nullable: string; column_default: string | null }[];

  console.log("");
  for (const c of cols) {
    console.log(
      `   ${c.table_name}.${c.column_name} — nullable ${c.is_nullable}, default ${c.column_default ?? "none"}`,
    );
  }

  const required = cols.find(
    (c) => c.table_name === "vehicles" && c.column_default?.includes("true"),
  );
  const nullable = cols.find(
    (c) => c.table_name === "vehicle_bookings" && c.is_nullable === "YES",
  );
  if (!required || !nullable) {
    console.error("\n✗ The schema is not in the expected shape — check the rows above.");
    process.exit(1);
  }

  const fleet = (await sql.query(
    `select name, reg_number, mileage_required from "vehicles" order by name`,
  )) as { name: string; reg_number: string; mileage_required: boolean }[];

  console.log(`\nFleet (${fleet.length}) — mileage mandatory?`);
  for (const v of fleet) {
    console.log(`   ${v.mileage_required ? "yes" : "NO "}  ${v.name} (${v.reg_number})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
