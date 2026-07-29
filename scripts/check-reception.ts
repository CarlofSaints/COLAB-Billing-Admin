import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL!);
async function main() {
  const rows = (await sql.query(
    `select s.name, s.email is not null as has_email, s.user_id is not null as has_login
       from staff s join staff_tags st on st.staff_id = s.id
       join tags t on t.id = st.tag_id
      where lower(t.name) = 'reception' and s.active`,
  )) as Record<string, unknown>[];
  console.log(`Reception-tagged: ${rows.length}`);
  for (const r of rows) console.log(`  ${r.name} email=${r.has_email} login=${r.has_login}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
