/**
 * Moves the issue types out of code and into the database, adds Places, and
 * adds the photo columns.
 *
 * Additive and idempotent. Seeds the nine types that were hard-coded in
 * lib/issues.ts so nothing changes on the form, plus "Something is finished".
 * Existing tickets are relinked to their type by name, so the grid and the new
 * list agree from the first run.
 *
 *   npx tsx scripts/add-issue-lists.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

/** The nine that were in code, in their original order, plus Carl's addition. */
const CATEGORIES: { name: string; description: string | null }[] = [
  { name: "Security", description: null },
  { name: "Plumbing", description: "Taps, toilets, leaks, blocked drains" },
  { name: "Electrical", description: "Lights, plugs, tripping breakers" },
  { name: "WiFi", description: null },
  { name: "Internet", description: null },
  { name: "Aircon", description: null },
  { name: "Admin", description: null },
  { name: "Signage", description: null },
  { name: "Something is finished", description: "Toilet paper, coffee, milk, soap — anything that's run out" },
  { name: "Other", description: null },
];

/** A starting set so the Places dropdown isn't empty — Carl edits from here. */
const PLACES: string[] = [
  "Reception",
  "Kitchen",
  "Bathrooms",
  "Boardroom",
  "Meeting rooms",
  "Open-plan area",
  "Parking",
  "Outside / grounds",
];

async function main() {
  await sql.query(
    `create table if not exists "issue_categories" (
       "id" serial primary key,
       "name" text not null,
       "description" text,
       "active" boolean not null default true,
       "sort_order" integer not null default 0,
       "created_at" timestamptz not null default now()
     )`,
  );
  await sql.query(
    `create unique index if not exists "issue_categories_name_unique"
       on "issue_categories" (lower("name"))`,
  );

  await sql.query(
    `create table if not exists "issue_places" (
       "id" serial primary key,
       "name" text not null,
       "description" text,
       "active" boolean not null default true,
       "sort_order" integer not null default 0,
       "created_at" timestamptz not null default now()
     )`,
  );
  await sql.query(
    `create unique index if not exists "issue_places_name_unique"
       on "issue_places" (lower("name"))`,
  );
  console.log("OK issue_categories, issue_places");

  await sql.query(
    `alter table "issues"
       add column if not exists "category_id" integer
         references "issue_categories"("id") on delete set null`,
  );
  await sql.query(
    `alter table "issues"
       add column if not exists "place_id" integer
         references "issue_places"("id") on delete set null`,
  );
  await sql.query(`alter table "issues" add column if not exists "place" text`);
  await sql.query(`alter table "issues" add column if not exists "photo_path" text`);
  await sql.query(`alter table "issues" add column if not exists "photo_content_type" text`);
  console.log("OK issues.category_id / place_id / place / photo_path / photo_content_type");

  let order = 0;
  for (const c of CATEGORIES) {
    order += 10;
    await sql.query(
      `insert into issue_categories (name, description, sort_order)
       values ($1, $2, $3)
       on conflict (lower(name)) do nothing`,
      [c.name, c.description, order],
    );
  }
  console.log(`OK seeded ${CATEGORIES.length} issue type(s)`);

  order = 0;
  for (const p of PLACES) {
    order += 10;
    await sql.query(
      `insert into issue_places (name, sort_order) values ($1, $2)
       on conflict (lower(name)) do nothing`,
      [p, order],
    );
  }
  console.log(`OK seeded ${PLACES.length} place(s)`);

  // Point existing tickets at their type. Matched on the text that's already
  // stored, so nothing needs re-typing and the history stays intact.
  const linked = (await sql.query(
    `update issues i set category_id = c.id
       from issue_categories c
      where i.category_id is null
        and lower(i.category) = lower(c.name)
      returning i.id`,
  )) as { id: number }[];
  console.log(`OK linked ${linked.length} existing ticket(s) to a type`);

  const orphans = (await sql.query(
    `select distinct category from issues where category_id is null`,
  )) as { category: string }[];
  if (orphans.length) {
    console.log(
      `\n⚠ ${orphans.length} ticket type(s) have no matching list entry (they keep their text):`,
    );
    for (const o of orphans) console.log(`    ${o.category}`);
  }

  const cats = (await sql.query(
    `select name, active from issue_categories order by sort_order, name`,
  )) as { name: string; active: boolean }[];
  console.log(`\nIssue types (${cats.length}):`);
  for (const c of cats) console.log(`  ${c.active ? " " : "·"} ${c.name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
