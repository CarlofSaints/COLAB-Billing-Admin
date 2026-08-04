/**
 * Splits Finance out of Admin, and opens Email Groups / Mail Sender to team
 * members.
 *
 *   npx tsx scripts/split-finance-role.ts          (dry run — shows the plan)
 *   npx tsx scripts/split-finance-role.ts --apply  (writes)
 *
 * WHY A SCRIPT AND NOT `db:seed`: seeding deliberately skips any role that
 * already has grants, so that Carl's edits in the Roles grid are never
 * clobbered. That protection also means a change to an EXISTING role's defaults
 * has no effect on a live database. The new `finance` role does get its grants
 * from the seed (it has none yet) — only these two adjustments need doing by
 * hand, and both are surgical: named keys added or removed, nothing reset.
 *
 * Run `npm run db:seed` FIRST so the finance role and its grants exist.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);
const APPLY = process.argv.includes("--apply");

/**
 * Everything that shows or moves money. Removed from Admin so the role can be
 * handed out widely; Finance carries them instead.
 *
 * `companies.view` is in here because it gates the billing dashboard as well as
 * the Sub-Companies page — leaving it would defeat the whole exercise.
 */
const REMOVE_FROM_ADMIN = [
  "billing.view",
  "billing.run",
  "controls.view",
  "companies.view",
];

/** Carl's call: the shared address book and announcements are for everyone. */
const ADD_TO_TEAM_MEMBER = ["groups.view", "mail.send"];

async function grantsFor(roleKey: string): Promise<string[]> {
  const rows = (await sql.query(
    `select p.key from role_permissions rp
       join roles r on r.id = rp.role_id
       join permissions p on p.id = rp.permission_id
      where r.key = $1 order by p.key`,
    [roleKey],
  )) as { key: string }[];
  return rows.map((r) => r.key);
}

async function main() {
  const roles = (await sql.query(
    `select r.key, r.name, r.rank,
            (select count(*)::int from users u where u.role_id = r.id and u.active) as users
       from roles r order by r.rank`,
  )) as { key: string; name: string; rank: number; users: number }[];

  console.log("Roles now:");
  for (const r of roles) console.log(`  ${r.name.padEnd(14)} rank ${r.rank}  ${r.users} active user(s)`);

  if (!roles.some((r) => r.key === "finance")) {
    console.error("\n✗ The `finance` role doesn't exist yet. Run `npm run db:seed` first.");
    process.exit(1);
  }

  const adminBefore = await grantsFor("admin");
  const teamBefore = await grantsFor("team_member");
  const financeGrants = await grantsFor("finance");

  const willRemove = REMOVE_FROM_ADMIN.filter((k) => adminBefore.includes(k));
  const willAdd = ADD_TO_TEAM_MEMBER.filter((k) => !teamBefore.includes(k));

  console.log(`\nFinance holds ${financeGrants.length}: ${financeGrants.join(", ")}`);
  console.log(
    `\nAdmin: remove ${willRemove.length ? willRemove.join(", ") : "(nothing — already done)"}`,
  );
  console.log(`Team Member: add ${willAdd.length ? willAdd.join(", ") : "(nothing — already done)"}`);

  // Who is about to lose the billing screens, by name — the point of the whole
  // change, and not something to discover afterwards.
  if (willRemove.length) {
    const affected = (await sql.query(
      `select u.name, u.email from users u join roles r on r.id = u.role_id
        where r.key = 'admin' and u.active order by u.name`,
    )) as { name: string; email: string }[];
    console.log(`\n⚠ ${affected.length} active Admin(s) lose the billing screens:`);
    for (const a of affected) console.log(`   ${a.name} <${a.email}>`);
    console.log(
      "   Give Finance to whoever actually does the invoicing (Users page → edit → Role).",
    );
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these changes.");
    return;
  }

  if (willRemove.length) {
    await sql.query(
      `delete from role_permissions rp
        using roles r, permissions p
        where rp.role_id = r.id and rp.permission_id = p.id
          and r.key = 'admin' and p.key = any($1::text[])`,
      [willRemove],
    );
  }

  if (willAdd.length) {
    await sql.query(
      `insert into role_permissions (role_id, permission_id)
       select r.id, p.id from roles r, permissions p
        where r.key = 'team_member' and p.key = any($1::text[])
       on conflict do nothing`,
      [willAdd],
    );
  }

  const adminAfter = await grantsFor("admin");
  const teamAfter = await grantsFor("team_member");
  console.log(`\n✓ Admin now holds ${adminAfter.length}: ${adminAfter.join(", ")}`);
  console.log(`✓ Team Member now holds ${teamAfter.length}: ${teamAfter.join(", ")}`);

  const stillThere = REMOVE_FROM_ADMIN.filter((k) => adminAfter.includes(k));
  const missing = ADD_TO_TEAM_MEMBER.filter((k) => !teamAfter.includes(k));
  if (stillThere.length || missing.length) {
    console.error(
      `\n✗ Not what was asked for — admin still has ${stillThere.join(", ") || "—"}, ` +
        `team_member is missing ${missing.join(", ") || "—"}`,
    );
    process.exit(1);
  }
  console.log("\nVerified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
