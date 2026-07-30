// Shared helpers for the reception rota. Pure functions — safe on client too.

export const RECEPTION_DEFAULTS = { startMin: 8 * 60, endMin: 17 * 60, slotMin: 30 };
export const RECEPTION_TAG = "Reception";

/** minutes-from-midnight → "HH:MM". */
export function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** "HH:MM" → minutes-from-midnight, or null if invalid. */
export function labelToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Build slot boundaries [start,end] from start→end in `slotMin` steps. */
export function buildSlotRanges(
  startMin: number,
  endMin: number,
  slotMin: number,
): { startMinute: number; endMinute: number }[] {
  const out: { startMinute: number; endMinute: number }[] = [];
  for (let s = startMin; s < endMin; s += slotMin) {
    out.push({ startMinute: s, endMinute: Math.min(s + slotMin, endMin) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* "You're on the desk shortly" reminders                              */
/* ------------------------------------------------------------------ */

/** How far ahead of a shift the nudge goes out. */
export const REMINDER_LEAD_MINUTES = 10;

/**
 * The cron is scheduled to land exactly on the reminder times rather than
 * polling — see the `crons` entry in vercel.json, which MUST stay in step with
 * these two constants. `20,50 4-16 * * *` in UTC is :20 and :50 past every
 * hour from 06:00 to 18:50 SAST, i.e. 10 minutes before every :00 and :30.
 *
 * Slot times are user-editable, though, so a grid can be configured that no
 * tick lines up with. `unreachableReminderStarts` finds those and the rota UI
 * warns rather than letting reminders go quietly missing.
 */
export const REMINDER_CRON_MINUTES = [20, 50];
export const REMINDER_CRON_HOURS_SAST = { first: 6, last: 18 };

/** Is a tick scheduled for this minutes-from-midnight (SAST)? */
function cronFiresAt(minuteOfDay: number): boolean {
  const hour = Math.floor(minuteOfDay / 60);
  if (hour < REMINDER_CRON_HOURS_SAST.first || hour > REMINDER_CRON_HOURS_SAST.last) return false;
  return REMINDER_CRON_MINUTES.includes(minuteOfDay % 60);
}

/**
 * Slot starts this grid would produce that no cron tick sits `lead` minutes
 * before — those shifts would never be reminded. Empty means the schedule and
 * the grid agree.
 */
export function unreachableReminderStarts(
  startMin: number,
  endMin: number,
  slotMin: number,
): number[] {
  if (!(slotMin > 0) || !(endMin > startMin)) return [];
  return buildSlotRanges(startMin, endMin, slotMin)
    .map((s) => s.startMinute)
    .filter((s) => !cronFiresAt(s - REMINDER_LEAD_MINUTES));
}

/** How late a tick may be and still count. */
export const REMINDER_GRACE_BEHIND = 5;
/** How early a tick may be and still count. */
export const REMINDER_GRACE_AHEAD = 5;

export type ReminderSlot = {
  id: number;
  startMinute: number;
  endMinute: number;
  staffId: number | null;
  reminderSentAt: Date | string | null;
};

export type DueShift<T extends ReminderSlot> = {
  /** Every slot the nudge covers — all of them get marked, one email goes out. */
  slots: T[];
  startMinute: number;
  endMinute: number;
  minutesUntil: number;
  /** True when the person is mid-shift already: no handover, so stay quiet. */
  alreadyOnDesk: boolean;
};

/**
 * Which shifts starting around `minuteOfDay` still need their nudge.
 *
 * Pure, and shared by the cron job and `scripts/check-reception-reminders.ts`,
 * so what the diagnostic prints is by construction what the job would do.
 *
 * `slots` must be one day's worth, ordered by start time. Selection is a window
 * rather than an exact match so a cron tick that lands a few minutes off still
 * sends; a tick that never lands is NOT backfilled, because telling someone to
 * go to the desk for a shift that began twenty minutes ago is worse than
 * saying nothing.
 */
export function selectDueShifts<T extends ReminderSlot>(
  slots: T[],
  minuteOfDay: number,
): DueShift<T>[] {
  const earliest = minuteOfDay + REMINDER_LEAD_MINUTES - REMINDER_GRACE_AHEAD;
  const latest = minuteOfDay + REMINDER_LEAD_MINUTES + REMINDER_GRACE_BEHIND;
  const out: DueShift<T>[] = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.staffId == null || slot.reminderSentAt) continue;
    if (slot.startMinute < earliest || slot.startMinute > latest) continue;

    const prev = slots[i - 1];
    const alreadyOnDesk =
      prev != null && prev.staffId === slot.staffId && prev.endMinute === slot.startMinute;

    // One unbroken stretch at the desk is one shift to the person doing it, so
    // it gets one email covering the full range — not one per 30-minute slot.
    const run = [slot];
    for (let j = i + 1; j < slots.length; j++) {
      const next = slots[j];
      const last = run[run.length - 1];
      if (next.staffId !== slot.staffId || next.startMinute !== last.endMinute) break;
      run.push(next);
    }

    out.push({
      slots: run,
      startMinute: slot.startMinute,
      endMinute: run[run.length - 1].endMinute,
      minutesUntil: slot.startMinute - minuteOfDay,
      alreadyOnDesk,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Weeks                                                               */
/* ------------------------------------------------------------------ */

/**
 * Date maths on YYYY-MM-DD strings via UTC midnight, so nothing shifts by a
 * day on a server that isn't in SAST. Mirrors the approach in lib/bookings.ts.
 */
function toUtc(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function addDays(key: string, days: number): string {
  const d = toUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: string): number {
  return (toUtc(key).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing this date. */
export function weekStart(key: string): string {
  return addDays(key, -weekdayIndex(key));
}

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** The office week. Weekends are off by default but can be ticked on. */
export const DEFAULT_WEEKDAYS = [0, 1, 2, 3, 4];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Mon 4 Aug" */
export function dayLabel(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${DAY_NAMES[weekdayIndex(key)].slice(0, 3)} ${d} ${MONTHS[m - 1]}`;
}

/** "4 – 10 Aug 2026" */
export function weekLabel(monday: string): string {
  const end = addDays(monday, 6);
  const [ay, am, ad] = monday.split("-").map(Number);
  const [by, bm, bd] = end.split("-").map(Number);
  const left = am === bm ? `${ad}` : `${ad} ${MONTHS[am - 1]}`;
  return `${left} – ${bd} ${MONTHS[bm - 1]} ${by === ay ? by : `${by}`}`;
}

/**
 * Who sits at the desk for each slot across a whole week.
 *
 * The rotation runs continuously through the week rather than restarting each
 * morning — reset it daily and whoever is first in the pool opens the desk
 * every single day, which is exactly the unfairness a rota is meant to remove.
 */
export function assignWeek<T>(
  pool: T[],
  days: { date: string; slots: number }[],
): { date: string; index: number; person: T | null }[] {
  const out: { date: string; index: number; person: T | null }[] = [];
  let cursor = 0;
  for (const day of days) {
    for (let i = 0; i < day.slots; i++) {
      out.push({
        date: day.date,
        index: i,
        person: pool.length ? pool[cursor % pool.length] : null,
      });
      cursor++;
    }
  }
  return out;
}
