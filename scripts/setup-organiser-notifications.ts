/**
 * Wires up the ORGANISER notifications Carl asked for.
 *
 *   npx tsx scripts/setup-organiser-notifications.ts            (dry run)
 *   npx tsx scripts/setup-organiser-notifications.ts --apply
 *
 * Creates a LIVE-RULE email group "Organisers" over the ORGANISER tag, and
 * points "a vehicle is booked" and "somebody reports an office issue" at it.
 *
 * A live rule, not a picked list, deliberately: tag somebody else ORGANISER
 * tomorrow and they start getting the emails without anyone remembering this
 * page exists. Untag them and they stop.
 *
 * Everything here is doable in the UI — this only saves the setup clicks and
 * proves the wiring end to end. Safe to run twice: it reuses an existing group
 * of the same name rather than making a second one.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);
const APPLY = process.argv.includes("--apply");

const GROUP_NAME = "Organisers";
const TAG_NAME = "ORGANISER";
/** Only the two Carl named. The rest stay on "Nobody else" until he says. */
const WIRE_UP = ["vehicle_booked", "issue_reported"];

async function main() {
  const [tag] = (await sql.query(`select id, name from "tags" where upper(name) = $1`, [
    TAG_NAME,
  ])) as { id: number; name: string }[];
  if (!tag) {
    console.error(`✗ No "${TAG_NAME}" tag exists yet. Create it on the Tags page first.`);
    process.exit(1);
  }
  console.log(`Tag "${tag.name}" is id ${tag.id}`);

  const tagged = (await sql.query(
    `select s.name, s.email, s.active
       from "staff_tags" st join "staff" s on s.id = st.staff_id
      where st.tag_id = $1 order by s.name`,
    [tag.id],
  )) as { name: string; email: string | null; active: boolean }[];

  console.log(`\nTagged ${TAG_NAME} (${tagged.length}):`);
  for (const p of tagged) {
    console.log(
      `   ${p.active ? "active  " : "INACTIVE"} ${p.name} — ${p.email ?? "NO EMAIL ADDRESS"}`,
    );
  }

  // The whole point of the feature is that somebody gets an email. A group that
  // resolves to nobody sendable is worth stopping for rather than saving.
  const sendable = tagged.filter((p) => p.active && (p.email ?? "").includes("@"));
  if (sendable.length === 0) {
    console.error(`\n✗ Nobody tagged ${TAG_NAME} is active with an email address.`);
    process.exit(1);
  }
  console.log(`\n${sendable.length} would actually be emailed.`);

  const rule = {
    companyId: null,
    tagIds: [tag.id],
    untaggedOnly: false,
    gender: null,
    includeInBilling: null,
    search: null,
  };

  if (!APPLY) {
    console.log(`\nDRY RUN — would:`);
    console.log(`   • create/reuse live-rule group "${GROUP_NAME}" (tag ${tag.id})`);
    for (const key of WIRE_UP) console.log(`   • set notify.${key} → that group`);
    console.log(`\nRe-run with --apply to write.`);
    return;
  }

  const [existing] = (await sql.query(`select id from "email_groups" where name = $1`, [
    GROUP_NAME,
  ])) as { id: number }[];

  let groupId: number;
  if (existing) {
    await sql.query(`update "email_groups" set rule = $1, updated_at = now() where id = $2`, [
      JSON.stringify(rule),
      existing.id,
    ]);
    groupId = existing.id;
    console.log(`\nOK reused group "${GROUP_NAME}" (id ${groupId}) and refreshed its rule`);
  } else {
    const [created] = (await sql.query(
      `insert into "email_groups" ("name","description","rule")
       values ($1,$2,$3) returning id`,
      [
        GROUP_NAME,
        "Everyone tagged ORGANISER. Live rule — tag or untag someone and this follows.",
        JSON.stringify(rule),
      ],
    )) as { id: number }[];
    groupId = created.id;
    console.log(`\nOK created live-rule group "${GROUP_NAME}" (id ${groupId})`);
  }

  for (const key of WIRE_UP) {
    await sql.query(
      `insert into "app_settings" ("key","value") values ($1,$2)
       on conflict ("key") do update set value = excluded.value, updated_at = now()`,
      [`notify.${key}`, String(groupId)],
    );
    console.log(`OK notify.${key} → ${GROUP_NAME}`);
  }

  const settings = (await sql.query(
    `select key, value from "app_settings" where key like 'notify.%' order by key`,
  )) as { key: string; value: string | null }[];
  console.log(`\nNotification settings now:`);
  for (const s of settings) console.log(`   ${s.key} = ${s.value ?? "(nobody)"}`);
  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
