/**
 * Grants the meeting-room permissions to the Admin and Director roles.
 *
 * The seed only fills in a role's grid when it has none, so roles that already
 * exist never pick up a newly added permission — it has to be granted once by
 * hand. Super Admin is covered by the code-level bypass.
 *
 *   npx tsx scripts/grant-room-perms.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

const ROLE_KEYS = ["admin", "director"];
const PERM_KEYS = ["rooms.manage", "bookings.manage"];

async function main() {
  const result = (await sql.query(
    `insert into role_permissions (role_id, permission_id)
     select r.id, p.id from roles r cross join permissions p
      where r.key = any($1) and p.key = any($2)
     on conflict do nothing
     returning role_id`,
    [ROLE_KEYS, PERM_KEYS],
  )) as { role_id: number }[];

  console.log(`✓ Granted ${result.length} role/permission pair(s).`);

  const check = (await sql.query(
    `select r.key as role, p.key as perm
       from role_permissions rp
       join roles r on r.id = rp.role_id
       join permissions p on p.id = rp.permission_id
      where p.key = any($1)
      order by r.key, p.key`,
    [PERM_KEYS],
  )) as { role: string; perm: string }[];

  for (const row of check) console.log(`  ${row.role} → ${row.perm}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
