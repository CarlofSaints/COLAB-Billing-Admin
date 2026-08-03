/**
 * Room-booking maths. Pure functions, no server imports — the calendar renders
 * off these on the client and the actions validate with the same code, so what
 * you see on the grid and what the server will accept can't drift apart.
 *
 * Times are minutes from midnight on a given SAST calendar date, matching the
 * reception rota. No Date arithmetic across timezones anywhere.
 */

/** The working window the calendar draws, and the slot size within it. */
export const DAY_START_MINUTE = 7 * 60; // 07:00
export const DAY_END_MINUTE = 18 * 60; // 18:00
export const SLOT_MINUTES = 30;
/** Shortest bookable meeting — someone wanting 20 minutes must still fit here. */
export const MIN_DURATION = 5;
/** How far ahead a recurring booking may be expanded, in occurrences. */
export const MAX_OCCURRENCES = 52;

export type BookingStatus = "confirmed" | "cancelled";

/** "08:30" from 510. */
export function minuteLabel(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** 510 from "08:30", or null if it isn't a time. */
export function labelToMinute(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** Every slot boundary the grid draws. */
export function slotStarts(
  start = DAY_START_MINUTE,
  end = DAY_END_MINUTE,
  step = SLOT_MINUTES,
): number[] {
  const out: number[] = [];
  for (let m = start; m < end; m += step) out.push(m);
  return out;
}

/* ------------------------------------------------------------------ */
/* Dates — handled as YYYY-MM-DD strings, never as local Date objects  */
/* ------------------------------------------------------------------ */

/** A date key from its parts, zero-padded. */
export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse "2026-07-29" into its parts. Returns null if malformed. */
export function parseDateKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * A date key as a UTC Date at midnight — safe for day arithmetic because the
 * time component never moves. Only ever converted back with `toDateKey`.
 */
export function keyToUtc(key: string): Date {
  const parts = parseDateKey(key);
  if (!parts) throw new Error(`Not a date key: ${key}`);
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
}

export function toDateKey(utc: Date): string {
  return dateKey(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function addDays(key: string, days: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateKey(d);
}

/** 0 = Monday … 6 = Sunday, so the calendar's columns index directly. */
export function weekdayIndex(key: string): number {
  return (keyToUtc(key).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing this date. */
export function weekStart(key: string): string {
  return addDays(key, -weekdayIndex(key));
}

/** The seven date keys of the week beginning at `monday`. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function dayShortName(key: string): string {
  return DAY_NAMES[weekdayIndex(key)].slice(0, 3);
}

/** "Wed 29 Jul 2026" — how a booking reads in an email. */
export function longDateLabel(key: string): string {
  const parts = parseDateKey(key);
  if (!parts) return key;
  return `${dayShortName(key)} ${parts.d} ${MONTHS[parts.m - 1].slice(0, 3)} ${parts.y}`;
}

/** "29 Jul – 4 Aug 2026" for the week header. */
export function weekRangeLabel(monday: string): string {
  const a = parseDateKey(monday);
  const sunday = addDays(monday, 6);
  const b = parseDateKey(sunday);
  if (!a || !b) return monday;
  const left = `${a.d} ${MONTHS[a.m - 1].slice(0, 3)}`;
  const right = `${b.d} ${MONTHS[b.m - 1].slice(0, 3)} ${b.y}`;
  return `${left} – ${right}`;
}

/* ------------------------------------------------------------------ */
/* Overlaps                                                            */
/* ------------------------------------------------------------------ */

export type Interval = { date: string; startMinute: number; endMinute: number };

/** Do two bookings on the same day collide? Touching ends do not. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.date === b.date && a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

/** The first existing booking each proposed slot would clash with. */
export function findConflicts<T extends Interval>(
  proposed: Interval[],
  existing: T[],
): { slot: Interval; clash: T }[] {
  const out: { slot: Interval; clash: T }[] = [];
  for (const slot of proposed) {
    const clash = existing.find((e) => overlaps(slot, e));
    if (clash) out.push({ slot, clash });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Recurrence                                                          */
/* ------------------------------------------------------------------ */

export type RecurrenceFrequency = "none" | "daily" | "weekly" | "monthly";
export type RecurrenceEnd = "count" | "date";

export type Recurrence = {
  frequency: RecurrenceFrequency;
  /** Every N days / weeks / months. */
  interval: number;
  /** Weekly only: 0 = Monday … 6 = Sunday. Empty means "same day as the start". */
  weekdays: number[];
  endMode: RecurrenceEnd;
  /** endMode "count": how many occurrences in total, including the first. */
  count: number;
  /** endMode "date": the last date an occurrence may fall on. */
  until: string;
};

export const DEFAULT_RECURRENCE: Recurrence = {
  frequency: "none",
  interval: 1,
  weekdays: [],
  endMode: "count",
  count: 10,
  until: "",
};

/**
 * The dates a recurrence produces, starting from `start`.
 *
 * Capped at MAX_OCCURRENCES so a fat-fingered "every day for 5 years" can't
 * write thousands of rows. The cap is reported rather than applied silently —
 * see `describeRecurrence` and the conflict summary in the booking action.
 */
export function expandRecurrence(start: string, rule: Recurrence): string[] {
  if (rule.frequency === "none") return [start];

  const interval = Math.max(1, Math.floor(rule.interval || 1));
  const limit =
    rule.endMode === "count"
      ? Math.min(Math.max(1, Math.floor(rule.count || 1)), MAX_OCCURRENCES)
      : MAX_OCCURRENCES;
  const until = rule.endMode === "date" && rule.until ? rule.until : null;
  const dates: string[] = [];

  const push = (key: string) => {
    if (until && key > until) return false;
    dates.push(key);
    return dates.length < limit;
  };

  if (rule.frequency === "daily") {
    let cursor = start;
    while (true) {
      if (!push(cursor)) break;
      cursor = addDays(cursor, interval);
      if (until && cursor > until) break;
    }
  } else if (rule.frequency === "weekly") {
    // No weekday chosen = repeat on the start day, which is what Outlook does
    // when you switch to weekly without touching the checkboxes.
    const days = rule.weekdays.length > 0 ? [...rule.weekdays].sort((a, b) => a - b) : [weekdayIndex(start)];
    let monday = weekStart(start);
    let guard = 0;
    outer: while (guard++ < 520) {
      for (const wd of days) {
        const key = addDays(monday, wd);
        if (key < start) continue;
        if (until && key > until) break outer;
        if (!push(key)) break outer;
      }
      monday = addDays(monday, 7 * interval);
    }
  } else {
    // Monthly on the same day number. A 31st that doesn't exist in a month is
    // skipped rather than sliding to the 1st of the next one.
    const parts = parseDateKey(start);
    if (!parts) return [start];
    let year = parts.y;
    let month = parts.m;
    let guard = 0;
    while (guard++ < 240) {
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (parts.d <= daysInMonth) {
        const key = dateKey(year, month, parts.d);
        if (key >= start) {
          if (until && key > until) break;
          if (!push(key)) break;
        }
      }
      month += interval;
      while (month > 12) {
        month -= 12;
        year += 1;
      }
    }
  }

  return dates;
}

/** "Every 2 weeks on Mon, Wed, until 30 Sep 2026" — shown in the UI and emails. */
export function describeRecurrence(rule: Recurrence): string {
  if (rule.frequency === "none") return "Does not repeat";
  const n = Math.max(1, Math.floor(rule.interval || 1));
  let base: string;
  if (rule.frequency === "daily") {
    base = n === 1 ? "Every day" : `Every ${n} days`;
  } else if (rule.frequency === "weekly") {
    const days =
      rule.weekdays.length > 0
        ? [...rule.weekdays].sort((a, b) => a - b).map((d) => DAY_NAMES[d].slice(0, 3)).join(", ")
        : null;
    base = n === 1 ? "Every week" : `Every ${n} weeks`;
    if (days) base += ` on ${days}`;
  } else {
    base = n === 1 ? "Every month" : `Every ${n} months`;
  }
  const ending =
    rule.endMode === "date" && rule.until
      ? `until ${longDateLabel(rule.until)}`
      : `for ${Math.max(1, Math.floor(rule.count || 1))} occurrences`;
  return `${base}, ${ending}`;
}

/** "09:00 – 09:30 (30 min)" */
/**
 * "20 min", "1 hour", "2 hours 30 min".
 *
 * Bookings can run the length of a working day, and "480 min" is not a thing
 * anyone reads as eight hours.
 */
export function durationLabel(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  const h = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest === 0 ? h : `${h} ${rest} min`;
}

export function slotLabel(startMinute: number, endMinute: number): string {
  return `${minuteLabel(startMinute)} – ${minuteLabel(endMinute)} (${durationLabel(endMinute - startMinute)})`;
}
