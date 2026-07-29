import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const q = async (label: string, statement: string) => {
    const rows = (await sql.query(statement)) as Record<string, unknown>[];
    console.log(`${label}: ${JSON.stringify(rows)}`);
  };
  await q("bookings", `select count(*)::int as n from room_bookings`);
  await q("attendees", `select count(*)::int as n from room_booking_attendees`);
  await q("rooms", `select count(*)::int as n from rooms`);
  await q("active users", `select count(*)::int as n from users where active`);
  await q("active staff", `select count(*)::int as n from staff where active`);
  await q(
    "team_member role perms",
    `select p.key from role_permissions rp
       join roles r on r.id = rp.role_id
       join permissions p on p.id = rp.permission_id
      where r.key = 'team_member' order by p.key`,
  );
}
main().catch((e) => { console.error(e); process.exit(1); });
