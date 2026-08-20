/**
 * Points "somebody asks to join the hub" at an email group.
 *
 * Join requests used to email Super Admin from a role list in the code, which
 * is one person. That routing now comes from the Notifications page — and an
 * unset setting means NOBODY is emailed, so this seeds it before the change
 * ships. Change it any time on /notifications; this script is only the seed.
 *
 *   npx tsx scripts/set-signup-notification.ts            (dry run)
 *   npx tsx scripts/set-signup-notification.ts --apply
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");
const sql = neon(url);

/** COLAB DIRECTORS — everyone in it holds team.invite, so they can act on it. */
const GROUP_NAME = "COLAB DIRECTORS";
const KEY = "notify.signup_requested";
const apply = process.argv.includes("--apply");

async function main() {
  const [group] = (await sql.query(`select id, name from email_groups where name = $1`, [
    GROUP_NAME,
  ])) as { id: number; name: string }[];
  if (!group) throw new Error(`No email group named "${GROUP_NAME}".`);

  const [existing] = (await sql.query(`select value from app_settings where key = $1`, [KEY])) as {
    value: string | null;
  }[];

  console.log(`${KEY}: ${existing?.value ?? "(unset)"} → ${group.id} (${group.name})`);
  if (existing?.value) {
    console.log("Already set — leaving it alone.");
    return;
  }
  if (!apply) {
    console.log("Dry run. Re-run with --apply to write it.");
    return;
  }

  await sql.query(
    `insert into app_settings (key, value) values ($1, $2)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [KEY, String(group.id)],
  );
  console.log("Written.");
}

main();
