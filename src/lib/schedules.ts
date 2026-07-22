/**
 * Recurrence maths for scheduled mail. Everything is reckoned in South
 * African time (UTC+2 year-round, no DST), so a reminder set for "the 25th"
 * goes out on the 25th locally regardless of where the cron fires from.
 *
 * Client-safe: the schedules UI uses these to preview the next send.
 */

export const SAST_OFFSET_MINUTES = 120;

export type Frequency = "monthly" | "weekly";
export type Audience = "groups" | "company_contacts";

export type ScheduleRule = {
  frequency: Frequency;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
};

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** The same instant, shifted so the getUTC* accessors read SAST wall-clock. */
function toSast(date: Date): Date {
  return new Date(date.getTime() + SAST_OFFSET_MINUTES * 60_000);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** SAST calendar date as YYYY-MM-DD — used to tell "already sent today" apart. */
export function sastDateKey(date: Date): string {
  const d = toSast(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Does this rule fire on the given SAST calendar day? A monthly schedule set
 * past the end of a short month (e.g. the 30th in February) fires on the last
 * day instead, so it never silently skips a month.
 */
function firesOn(rule: ScheduleRule, sastDate: Date): boolean {
  if (rule.frequency === "weekly") {
    return rule.dayOfWeek != null && sastDate.getUTCDay() === rule.dayOfWeek;
  }
  if (rule.dayOfMonth == null) return false;
  const last = daysInMonth(sastDate.getUTCFullYear(), sastDate.getUTCMonth());
  return sastDate.getUTCDate() === Math.min(rule.dayOfMonth, last);
}

/**
 * Should this schedule send right now? True when today matches the rule and
 * it hasn't already gone out today — so a re-run of the cron can't double-send.
 */
export function isDue(
  rule: ScheduleRule,
  lastRunAt: Date | string | null,
  now: Date = new Date(),
): boolean {
  if (!firesOn(rule, toSast(now))) return false;
  if (!lastRunAt) return true;
  const last = typeof lastRunAt === "string" ? new Date(lastRunAt) : lastRunAt;
  return sastDateKey(last) !== sastDateKey(now);
}

/**
 * The next SAST date this schedule will fire, as a UTC Date at 06:00 SAST
 * (when the cron runs). Returns null if the rule can never fire.
 */
export function nextRun(
  rule: ScheduleRule,
  lastRunAt: Date | string | null,
  now: Date = new Date(),
): Date | null {
  const start = toSast(now);
  for (let i = 0; i < 400; i++) {
    const day = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i),
    );
    if (!firesOn(rule, day)) continue;
    // Today only counts if it hasn't already been sent.
    if (i === 0 && !isDue(rule, lastRunAt, now)) continue;
    // 06:00 SAST = 04:00 UTC.
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 4, 0));
  }
  return null;
}

/** Plain-English description of the rule, e.g. "Monthly on the 25th". */
export function describeRule(rule: ScheduleRule): string {
  if (rule.frequency === "weekly") {
    return rule.dayOfWeek == null ? "Weekly" : `Every ${WEEKDAYS[rule.dayOfWeek]}`;
  }
  if (rule.dayOfMonth == null) return "Monthly";
  return `Monthly on the ${ordinal(rule.dayOfMonth)}`;
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * Merge tokens available in a reminder's subject and body. Kept deliberately
 * small so the editor can list them all.
 */
export const MERGE_TOKENS = [
  { token: "{{company}}", hint: "The sub-company's name" },
  { token: "{{contact}}", hint: "The contact person's name" },
  { token: "{{month}}", hint: "The current month, e.g. July 2026" },
  { token: "{{link}}", hint: "A link to the staff page" },
] as const;

export function applyTokens(
  text: string,
  values: { company?: string; contact?: string; month: string; link: string },
): string {
  return text
    .replace(/\{\{company\}\}/g, values.company ?? "your company")
    .replace(/\{\{contact\}\}/g, values.contact ?? "there")
    .replace(/\{\{month\}\}/g, values.month)
    .replace(/\{\{link\}\}/g, values.link);
}

/** "July 2026" in SAST — used for the {{month}} token. */
export function monthLabel(now: Date = new Date()): string {
  const d = toSast(now);
  return new Intl.DateTimeFormat("en-ZA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}
