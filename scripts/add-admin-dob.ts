/**
 * Adds `staff.date_of_birth_admin` — an admin's stand-in date of birth, used
 * only where the person hasn't set their own. Additive, one nullable column.
 *
 *   npx tsx scripts/add-admin-dob.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

async function main() {
  await sql.query(`alter table "staff" add column if not exists "date_of_birth_admin" date`);
  console.log("OK staff.date_of_birth_admin");

  const rows = (await sql.query(
    `select count(*)::int as with_own,
            (select count(*)::int from staff where date_of_birth is null and active) as missing
       from staff where date_of_birth is not null`,
  )) as { with_own: number; missing: number }[];
  console.log(
    `\n${rows[0]?.with_own ?? 0} people have set their own DOB; ` +
      `${rows[0]?.missing ?? 0} active people have none yet.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
