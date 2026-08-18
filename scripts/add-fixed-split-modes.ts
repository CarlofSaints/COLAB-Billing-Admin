/**
 * Adds the four dynamic split types to the `fixed_split_mode` enum, so a fixed
 * line item can be split per m², per head, evenly, or straight to one company
 * as well as by quantity or a typed percentage.
 *
 * Purely additive — no existing row changes, and every current value stays
 * valid — and written out by hand rather than left to `drizzle-kit push`,
 * which recreates an enum it sees as changed and would take the column with it.
 *
 *   npx tsx scripts/add-fixed-split-modes.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

const values = ["per_sqm", "headcount", "equal", "direct"];

async function main() {
  for (const value of values) {
    // ADD VALUE cannot run inside a transaction; the http driver sends each
    // statement on its own, so this is fine as-is.
    await sql.query(`alter type "fixed_split_mode" add value if not exists '${value}'`);
    console.log(`✓ ${value}`);
  }

  const rows = (await sql.query(
    `select enumlabel from pg_enum
       join pg_type on pg_type.oid = pg_enum.enumtypid
      where pg_type.typname = 'fixed_split_mode'
      order by enumsortorder`,
  )) as { enumlabel: string }[];
  const labels = rows.map((r) => r.enumlabel);
  const missing = values.filter((v) => !labels.includes(v));
  console.log(`\nfixed_split_mode is now: ${labels.join(", ")}`);
  console.log(missing.length === 0 ? "✓ All four present." : `⚠ Still missing: ${missing.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
