/**
 * Did the reception cron actually fire, and what did it do?
 *
 *   npx tsx scripts/check-reminder-runs.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const slots = (await sql.query(
    `select s.start_minute, s.end_minute, s.reminder_sent_at, st.name
       from reception_slots s join staff st on st.id = s.staff_id
      where s.date = current_date
      order by s.start_minute`,
  )) as { start_minute: number; reminder_sent_at: string | null; name: string }[];

  console.log("TODAY'S RECEPTION SLOTS");
  for (const r of slots) {
    const h = String(Math.floor(r.start_minute / 60)).padStart(2, "0");
    const m = String(r.start_minute % 60).padStart(2, "0");
    console.log(
      `  ${h}:${m}  ${r.name.padEnd(20)} reminded: ${r.reminder_sent_at ?? "not yet"}`,
    );
  }

  const log = (await sql.query(
    `select action, summary, created_at from activity_log
      where action like 'reception%' order by created_at desc limit 8`,
  )) as { action: string; summary: string; created_at: string }[];

  console.log("\nACTIVITY LOG (reception)");
  if (log.length === 0) console.log("  nothing logged yet");
  for (const r of log) console.log(`  ${r.created_at}  ${r.summary}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
