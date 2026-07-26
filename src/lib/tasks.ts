/**
 * Shared labels/options for the admin task scheduler. Plain constants so both
 * server actions/emails and client components can use them.
 */

export const TASK_PRIORITIES = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Can wait" },
] as const;

export const TASK_RECURRENCES = [
  { value: "once", label: "Once-off" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number]["value"];
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number]["value"];

export function priorityLabel(v: string): string {
  return TASK_PRIORITIES.find((p) => p.value === v)?.label ?? v;
}

export function recurrenceLabel(v: string): string {
  return TASK_RECURRENCES.find((r) => r.value === v)?.label ?? v;
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Format a "YYYY-MM-DD" date as e.g. "12 Aug 2026" (timezone-safe). */
export function formatTaskDate(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return `${day} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** Badge tone for each priority (matches the ui Badge tones). */
export function priorityTone(v: string): "red" | "amber" | "brand" | "slate" {
  switch (v) {
    case "urgent":
      return "red";
    case "high":
      return "amber";
    case "low":
      return "slate";
    default:
      return "brand";
  }
}
