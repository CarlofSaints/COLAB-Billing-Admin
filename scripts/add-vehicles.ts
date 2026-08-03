/**
 * Creates the vehicles table — the shared fleet register.
 * Additive only: a new table, nothing existing is touched.
 *
 *   npx tsx scripts/add-vehicles.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

const statements: [string, string][] = [
  [
    "vehicles",
    `create table if not exists "vehicles" (
       "id" serial primary key,
       "name" text not null,
       "nickname" text,
       "vin" text,
       "reg_number" text not null,
       "colour" text,
       "branded" boolean not null default false,
       "company_id" integer not null references "companies"("id") on delete restrict,
       "active" boolean not null default true,
       "created_at" timestamp with time zone not null default now(),
       "updated_at" timestamp with time zone not null default now()
     )`,
  ],
  [
    "vehicles_reg_unique",
    `create unique index if not exists "vehicles_reg_unique"
       on "vehicles" (lower("reg_number"))`,
  ],
  [
    // Partial: only the VINs actually entered are constrained, so several
    // vehicles may sit there with no VIN without colliding with each other.
    "vehicles_vin_unique",
    `create unique index if not exists "vehicles_vin_unique"
       on "vehicles" (lower("vin")) where "vin" is not null`,
  ],
];

async function main() {
  for (const [label, statement] of statements) {
    await sql.query(statement);
    console.log(`OK ${label}`);
  }

  const cols = (await sql.query(
    `select column_name, data_type, is_nullable from information_schema.columns
      where table_name = 'vehicles' order by ordinal_position`,
  )) as { column_name: string; data_type: string; is_nullable: string }[];
  console.log(`\nColumns:`);
  for (const c of cols) {
    console.log(`  ${c.column_name} ${c.data_type}${c.is_nullable === "NO" ? " not null" : ""}`);
  }

  const idx = (await sql.query(
    `select indexname from pg_indexes where tablename = 'vehicles' order by indexname`,
  )) as { indexname: string }[];
  console.log(`Indexes: ${idx.map((i) => i.indexname).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
