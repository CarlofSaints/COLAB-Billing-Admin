import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string, currency = "ZAR"): string {
  const n = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export function formatDateTime(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

/**
 * Reads a yes/no answer from a spreadsheet cell or form field. Blank means
 * yes — a person is billable unless someone says otherwise.
 */
export function parseYesNo(value: unknown, fallback = true): boolean {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  if (["no", "n", "false", "0", "exclude", "excluded"].includes(raw)) return false;
  if (["yes", "y", "true", "1", "include", "included"].includes(raw)) return true;
  return fallback;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
