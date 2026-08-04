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

/**
 * Finance is Admin PLUS the money — so its grants are computed from whatever
 * Admin actually holds, not from a second hand-written list. Carl has edited
 * the Admin grid by hand (it carries users.manage, which the code defaults
 * never gave it), and a hard-coded copy would have silently missed that.
 *
 * Note the order this runs in: Finance is topped up from Admin's grants BEFORE
 * the money keys are stripped from Admin, so nothing is lost in between.
 */

/**
 * The people moving from Admin to Finance — Carl's list, 4 Aug 2026. Recorded
 * here rather than clicked through the UI so the change is auditable and
 * repeatable. Matched on email; a name that doesn't resolve is reported, never
 * guessed at.
 */
const MOVE_TO_FINANCE = [
  "ben@atomicmarketing.co.za",
  "chantellmcgregor@iram.co.za",
  "jennifer@outerjoin.co.za",
  "nicki@outerjoin.co.za",
  "toniel@iram.co.za",
  "tyrone@colab2.co.za",
  "venita@atomicmarketing.co.za",
];

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

  // Finance = everything Admin holds today, plus the money. Read off the live
  // Admin grid so hand-edits there are carried across rather than missed.
  const financeTarget = [...new Set([...adminBefore, ...REMOVE_FROM_ADMIN])];
  const financeMissing = financeTarget.filter((k) => !financeGrants.includes(k));

  console.log(`\nFinance holds ${financeGrants.length}: ${financeGrants.join(", ")}`);
  console.log(
    `Finance: add ${financeMissing.length ? financeMissing.join(", ") : "(nothing — already a superset of Admin)"}`,
  );
  console.log(
    `\nAdmin: remove ${willRemove.length ? willRemove.join(", ") : "(nothing — already done)"}`,
  );
  console.log(`Team Member: add ${willAdd.length ? willAdd.join(", ") : "(nothing — already done)"}`);

  const movers = (await sql.query(
    `select u.name, u.email, r.name as role from users u join roles r on r.id = u.role_id
      where lower(u.email) = any($1::text[]) order by u.name`,
    [MOVE_TO_FINANCE.map((e) => e.toLowerCase())],
  )) as { name: string; email: string; role: string }[];
  const unresolved = MOVE_TO_FINANCE.filter(
    (e) => !movers.some((m) => m.email.toLowerCase() === e.toLowerCase()),
  );
  console.log(`\nMoving to Finance (${movers.length} of ${MOVE_TO_FINANCE.length}):`);
  for (const m of movers) console.log(`   ${m.name} <${m.email}> — currently ${m.role}`);
  if (unresolved.length) console.log(`   ⚠ no user found for: ${unresolved.join(", ")}`);

  // Who stays on Admin and therefore loses the billing screens — the point of
  // the whole change, and not something to discover afterwards.
  const staying = (await sql.query(
    `select u.name, u.email from users u join roles r on r.id = u.role_id
      where r.key = 'admin' and u.active and not (lower(u.email) = any($1::text[]))
      order by u.name`,
    [MOVE_TO_FINANCE.map((e) => e.toLowerCase())],
  )) as { name: string; email: string }[];
  console.log(`\n⚠ Staying on Admin, so losing the billing screens (${staying.length}):`);
  for (const a of staying) console.log(`   ${a.name} <${a.email}>`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these changes.");
    return;
  }

  // Finance is topped up FIRST, so nothing is briefly missing from both roles.
  if (financeMissing.length) {
    await sql.query(
      `insert into role_permissions (role_id, permission_id)
       select r.id, p.id from roles r, permissions p
        where r.key = 'finance' and p.key = any($1::text[])
       on conflict do nothing`,
      [financeMissing],
    );
  }

  if (movers.length) {
    await sql.query(
      `update users set role_id = (select id from roles where key = 'finance'),
                        updated_at = now()
        where lower(email) = any($1::text[])`,
      [MOVE_TO_FINANCE.map((e) => e.toLowerCase())],
    );
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
  const financeAfter = await grantsFor("finance");
  console.log(`\n✓ Finance now holds ${financeAfter.length}: ${financeAfter.join(", ")}`);
  console.log(`✓ Admin now holds ${adminAfter.length}: ${adminAfter.join(", ")}`);
  console.log(`✓ Team Member now holds ${teamAfter.length}: ${teamAfter.join(", ")}`);

  const counts = (await sql.query(
    `select r.name, count(u.id)::int as n from roles r
       left join users u on u.role_id = r.id and u.active
      group by r.name, r.rank order by r.rank`,
  )) as { name: string; n: number }[];
  console.log(`\n✓ ${counts.map((c) => `${c.name}: ${c.n}`).join(" · ")}`);

  // Verify the three things that were actually asked for, rather than trusting
  // that the statements above ran.
  const stillThere = REMOVE_FROM_ADMIN.filter((k) => adminAfter.includes(k));
  const missing = ADD_TO_TEAM_MEMBER.filter((k) => !teamAfter.includes(k));
  const notSuperset = adminAfter.filter((k) => !financeAfter.includes(k));
  const stillAdmin = (await sql.query(
    `select u.email from users u join roles r on r.id = u.role_id
      where r.key <> 'finance' and lower(u.email) = any($1::text[])`,
    [MOVE_TO_FINANCE.map((e) => e.toLowerCase())],
  )) as { email: string }[];

  if (stillThere.length || missing.length || notSuperset.length || stillAdmin.length) {
    console.error(
      `\n✗ Not what was asked for — admin still has ${stillThere.join(", ") || "—"}; ` +
        `team_member missing ${missing.join(", ") || "—"}; ` +
        `finance missing ${notSuperset.join(", ") || "—"}; ` +
        `not moved: ${stillAdmin.map((u) => u.email).join(", ") || "—"}`,
    );
    process.exit(1);
  }
  console.log("Verified: Finance ⊇ Admin, Admin has no money keys, all 7 moved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
