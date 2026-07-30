/**
 * Adds the column that turns an email group into a saved filter.
 *
 * Additive and idempotent — one nullable jsonb column. Existing groups keep
 * `rule = null`, which means "hand-picked member list", so nothing changes
 * behaviour until a group is deliberately made live.
 *
 *   npx tsx scripts/add-group-rules.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(`alter table "email_groups" add column if not exists "rule" jsonb`);
  console.log("OK email_groups.rule");

  const rows = (await sql.query(
    `select g.name,
            (g.rule is not null) as live,
            (select count(*)::int from email_group_members m where m.group_id = g.id) as picked
       from email_groups g
      order by g.name`,
  )) as { name: string; live: boolean; picked: number }[];

  console.log(`\n${rows.length} group(s):`);
  for (const r of rows) {
    console.log(`  ${r.live ? "LIVE RULE" : "picked   "}  ${r.name}  (${r.picked} picked member(s))`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
