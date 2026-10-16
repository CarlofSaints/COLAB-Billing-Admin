/**
 * Adds the Draft → Final step to invoice_run_drafts. A row with finalised_at set
 * is locked and is the only thing that can be sent to Xero. Additive, idempotent.
 *
 *   npx tsx scripts/add-invoice-run-final.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(`alter table "invoice_run_drafts" add column if not exists "finalised_at" timestamptz`);
  await sql.query(`alter table "invoice_run_drafts" add column if not exists "finalised_by_name" text`);

  const cols = (await sql.query(
    `select column_name from information_schema.columns
      where table_name = 'invoice_run_drafts' and column_name in ('finalised_at', 'finalised_by_name')`,
  )) as { column_name: string }[];
  if (cols.length !== 2) throw new Error(`expected 2 new columns, found ${cols.length}`);
  console.log("OK invoice_run_drafts.finalised_at, finalised_by_name");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
