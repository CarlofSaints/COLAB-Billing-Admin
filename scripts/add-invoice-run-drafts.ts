/**
 * Adds the table that holds hand edits to an Invoice Run between saving and
 * sending to Xero. Without it every edit lived only in the browser and was lost
 * on a refresh, a month switch or any server re-render.
 *
 * `db:push` is interactive and hangs in an agent shell, so additive DDL is run
 * as explicit SQL instead. Idempotent, and it re-reads information_schema at the
 * end rather than trusting `if not exists`.
 *
 *   npx tsx scripts/add-invoice-run-drafts.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(
    `create table if not exists "invoice_run_drafts" (
       "id" serial primary key,
       "period" text not null,
       "run_type" "invoice_run_type" not null,
       "companies" jsonb not null,
       "calculated_total" numeric(14, 2) not null default 0,
       "saved_by_user_id" integer,
       "saved_by_name" text,
       "saved_at" timestamptz not null default now()
     )`,
  );
  await sql.query(
    `create unique index if not exists "invoice_run_drafts_period_run_unique"
       on "invoice_run_drafts" ("period", "run_type")`,
  );
  console.log("OK invoice_run_drafts");

  const cols = (await sql.query(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_name = 'invoice_run_drafts'
      order by ordinal_position`,
  )) as { column_name: string; data_type: string; is_nullable: string }[];

  if (cols.length === 0) throw new Error("invoice_run_drafts was not created");
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(18)} ${c.data_type} ${c.is_nullable === "YES" ? "null" : "not null"}`);
  }

  const idx = (await sql.query(
    `select indexname from pg_indexes
      where tablename = 'invoice_run_drafts' order by indexname`,
  )) as { indexname: string }[];
  console.log(`indexes: ${idx.map((i) => i.indexname).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
