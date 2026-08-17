/**
 * Adds the "forgot password" token table.
 *
 * `db:push` is interactive and hangs in an agent shell, so additive DDL is run
 * as explicit SQL instead. Idempotent — safe to re-run — and it re-reads
 * information_schema at the end rather than trusting `if not exists` to have
 * done what it says.
 *
 * No new permission: forgetting your password is not a privilege, and the pages
 * that use this table are public (a signed-out person cannot hold a role).
 *
 *   npx tsx scripts/add-password-resets.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(
    `create table if not exists "password_reset_tokens" (
       "id" serial primary key,
       "user_id" integer not null references "users"("id") on delete cascade,
       "token_hash" text not null,
       "expires_at" timestamptz not null,
       "used_at" timestamptz,
       "created_at" timestamptz not null default now()
     )`,
  );
  await sql.query(
    `create unique index if not exists "password_reset_token_hash_unique"
       on "password_reset_tokens" ("token_hash")`,
  );
  await sql.query(
    `create index if not exists "password_reset_user_idx"
       on "password_reset_tokens" ("user_id")`,
  );
  console.log("OK password_reset_tokens");

  const cols = (await sql.query(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_name = 'password_reset_tokens'
      order by ordinal_position`,
  )) as { column_name: string; data_type: string; is_nullable: string }[];

  if (cols.length === 0) throw new Error("password_reset_tokens was not created");
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(12)} ${c.data_type} ${c.is_nullable === "YES" ? "null" : "not null"}`);
  }

  const idx = (await sql.query(
    `select indexname from pg_indexes
      where tablename = 'password_reset_tokens' order by indexname`,
  )) as { indexname: string }[];
  console.log(`indexes: ${idx.map((i) => i.indexname).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
