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
