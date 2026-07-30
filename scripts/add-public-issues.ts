/**
 * Columns for issues reported from the public QR-code page.
 *
 * Additive and idempotent. Existing tickets default to `source = 'hub'`, which
 * is correct — everything reported so far came from a signed-in user.
 *
 *   npx tsx scripts/add-public-issues.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(
    `alter table "issues"
       add column if not exists "source" text not null default 'hub'`,
  );
  await sql.query(`alter table "issues" add column if not exists "reported_by_staff_id" integer`);
  await sql.query(`alter table "issues" add column if not exists "reporter_ip_hash" text`);
  console.log("OK issues.source / reported_by_staff_id / reporter_ip_hash");

  // The rate limiter counts recent rows for one IP hash — without this it'd be
  // a sequential scan of the whole table on every public submission.
  await sql.query(
    `create index if not exists "issues_reporter_ip_idx"
       on "issues" ("reporter_ip_hash", "created_at")`,
  );
  console.log("OK issues_reporter_ip_idx");

  const [row] = (await sql.query(
    `select count(*)::int as total,
            count(*) filter (where source = 'public')::int as public
       from issues`,
  )) as { total: number; public: number }[];
  console.log(`issues: ${row.total} total, ${row.public} from the public page`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
