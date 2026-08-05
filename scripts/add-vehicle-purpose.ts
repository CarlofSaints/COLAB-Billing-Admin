/**
 * Puts "why are you taking the vehicle?" back on the booking form.
 *
 *   npx tsx scripts/add-vehicle-purpose.ts
 *
 * Its own column, not a reuse of `notes`. `notes` is written at the RETURN and
 * is about what happened to the vehicle — a scratch, a warning light — so
 * sharing one field would mean recording the scratch erased the reason anyone
 * had the car. The two are read together on the trip detail.
 *
 * Additive and safe to run twice; nothing existing changes.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(`alter table "vehicle_bookings" add column if not exists "purpose" text`);
  console.log("OK vehicle_bookings.purpose");

  const cols = (await sql.query(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_name = 'vehicle_bookings' and column_name in ('purpose','notes')
      order by column_name`,
  )) as { column_name: string; data_type: string; is_nullable: string }[];

  console.log("");
  for (const c of cols) {
    console.log(`   ${c.column_name.padEnd(10)} ${c.data_type}, nullable ${c.is_nullable}`);
  }

  if (cols.length !== 2) {
    console.error("\n✗ Expected both purpose and notes to exist.");
    process.exit(1);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
