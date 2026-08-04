/**
 * Replaces the binary "can book other companies' vehicles" flag with a list of
 * companies per person.
 *
 *   npx tsx scripts/add-staff-vehicle-companies.ts
 *
 * Migrates before it drops: anyone currently flagged `true` is given every
 * sub-company except their own, which is exactly what the flag meant. Only then
 * is the column removed, and only if the migration accounted for everyone.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(
    `create table if not exists "staff_vehicle_companies" (
       "staff_id" integer not null references "staff"("id") on delete cascade,
       "company_id" integer not null references "companies"("id") on delete cascade,
       primary key ("staff_id", "company_id")
     )`,
  );
  console.log("OK staff_vehicle_companies");

  // Only if the old column is still there — this script has to be safe to run
  // twice, and the second run has nothing to migrate.
  const hasFlag = (await sql.query(
    `select 1 from information_schema.columns
      where table_name = 'staff' and column_name = 'can_book_other_company_vehicles'`,
  )) as unknown[];

  if (hasFlag.length === 0) {
    console.log("• old flag already gone — nothing to migrate");
  } else {
    const flagged = (await sql.query(
      `select id, name from "staff" where "can_book_other_company_vehicles" = true`,
    )) as { id: number; name: string }[];
    console.log(`Flagged under the old boolean: ${flagged.length}`);
    for (const f of flagged) console.log(`   ${f.name}`);

    if (flagged.length > 0) {
      // "Any company" becomes "every sub-company except your own" — their own
      // is implicit and deliberately never stored.
      await sql.query(
        `insert into "staff_vehicle_companies" ("staff_id", "company_id")
         select s.id, c.id
           from "staff" s
           join "companies" c on c.type = 'sub' and c.id <> s.company_id
          where s."can_book_other_company_vehicles" = true
         on conflict do nothing`,
      );
      const migrated = (await sql.query(
        `select count(distinct staff_id)::int as n from "staff_vehicle_companies"`,
      )) as { n: number }[];
      if (migrated[0].n < flagged.length) {
        console.error(
          `✗ ${flagged.length} were flagged but only ${migrated[0].n} have rows — not dropping the column.`,
        );
        process.exit(1);
      }
      console.log(`OK migrated ${migrated[0].n} person(s)`);
    }

    await sql.query(
      `alter table "staff" drop column if exists "can_book_other_company_vehicles"`,
    );
    console.log("OK dropped staff.can_book_other_company_vehicles");
  }

  const rows = (await sql.query(
    `select s.name as staff, c.name as company
       from "staff_vehicle_companies" svc
       join "staff" s on s.id = svc.staff_id
       join "companies" c on c.id = svc.company_id
      order by s.name, c.name`,
  )) as { staff: string; company: string }[];
  console.log(`\nCross-company vehicle grants: ${rows.length}`);
  for (const r of rows) console.log(`   ${r.staff} → ${r.company}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
