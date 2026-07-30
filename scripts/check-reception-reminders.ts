/**
 * Dry-run for the reception nudge: prints what the cron WOULD email, without
 * sending anything or touching `reminder_sent_at`.
 *
 * It replays every scheduled tick across a day, so a whole day's reminders can
 * be checked in one go instead of waiting for 07:50 to come round. The shift
 * selection is imported from lib/reception — the same function the job uses —
 * so this can't drift from the real behaviour.
 *
 *   npx tsx scripts/check-reception-reminders.ts            # today (SAST)
 *   npx tsx scripts/check-reception-reminders.ts 2026-08-03
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import {
  REMINDER_CRON_HOURS_SAST,
  REMINDER_CRON_MINUTES,
  REMINDER_LEAD_MINUTES,
  dayLabel,
  minutesToLabel,
  selectDueShifts,
} from "../src/lib/reception";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

type Row = {
  id: number;
  start_minute: number;
  end_minute: number;
  staff_id: number | null;
  reminder_sent_at: string | null;
  name: string;
  email: string | null;
};

/** Every minute-of-day the cron in vercel.json fires at. */
function tickTimes(): number[] {
  const out: number[] = [];
  for (let h = REMINDER_CRON_HOURS_SAST.first; h <= REMINDER_CRON_HOURS_SAST.last; h++) {
    for (const m of REMINDER_CRON_MINUTES) out.push(h * 60 + m);
  }
  return out.sort((a, b) => a - b);
}

async function main() {
  const arg = process.argv[2];
  const dateKey = arg ?? new Date(Date.now() + 120 * 60_000).toISOString().slice(0, 10);

  const rows = (await sql.query(
    `select s.id, s.start_minute, s.end_minute, s.staff_id, s.reminder_sent_at,
            st.name, st.email
       from reception_slots s
       join staff st on st.id = s.staff_id
      where s.date = $1 and s.staff_id is not null
      order by s.start_minute, s.id`,
    [dateKey],
  )) as Row[];

  console.log(`\n${dayLabel(dateKey)} (${dateKey}) — ${rows.length} assigned slot(s)\n`);
  if (rows.length === 0) {
    console.log("Nothing on the rota for this day, so no reminders would go out.");
    return;
  }

  const slots = rows.map((r) => ({
    id: r.id,
    startMinute: r.start_minute,
    endMinute: r.end_minute,
    staffId: r.staff_id,
    // Deliberately ignored: this is a dry run of a clean day, so an already
    // reminded slot doesn't hide what the schedule would have done.
    reminderSentAt: null,
    name: r.name,
    email: r.email,
  }));

  const covered = new Set<number>();
  let emails = 0;

  for (const tick of tickTimes()) {
    const remaining = slots.map((s) => ({
      ...s,
      reminderSentAt: covered.has(s.id) ? new Date() : null,
    }));
    for (const shift of selectDueShifts(remaining, tick)) {
      shift.slots.forEach((s) => covered.add(s.id));
      const person = shift.slots[0];
      const range = `${minutesToLabel(shift.startMinute)} – ${minutesToLabel(shift.endMinute)}`;
      const at = minutesToLabel(tick);

      if (shift.alreadyOnDesk) {
        console.log(`  ${at}  (no email) ${person.name} is already at the desk — ${range}`);
      } else if (!person.email) {
        console.log(`  ${at}  ⚠ NO EMAIL ADDRESS for ${person.name} — ${range}`);
      } else {
        emails++;
        const merged = shift.slots.length > 1 ? ` [${shift.slots.length} slots merged]` : "";
        console.log(
          `  ${at}  → ${person.name} <${person.email}>  ${range}` +
            ` (in ${shift.minutesUntil} min)${merged}`,
        );
      }
    }
  }

  const missed = slots.filter((s) => !covered.has(s.id));
  console.log(`\n${emails} email(s) would go out across the day.`);

  if (missed.length) {
    console.log(
      `\n⚠ ${missed.length} slot(s) NO TICK REACHES — the cron fires at ` +
        `${REMINDER_CRON_MINUTES.map((m) => `:${m}`).join(" and ")} past the hour, which is ` +
        `${REMINDER_LEAD_MINUTES} min before :00 and :30 only:`,
    );
    for (const s of missed) {
      console.log(
        `    ${minutesToLabel(s.startMinute)} – ${minutesToLabel(s.endMinute)}  ${s.name}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
