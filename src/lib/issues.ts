// Shared vocabulary for office issue tickets. Plain constants — client + server.

export const ISSUE_CATEGORIES = [
  "Security",
  "Plumbing",
  "Electrical",
  "WiFi",
  "Internet",
  "Aircon",
  "Admin",
  "Signage",
  "Other",
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export function isIssueCategory(v: string): v is IssueCategory {
  return (ISSUE_CATEGORIES as readonly string[]).includes(v);
}

export const ISSUE_STATUSES = [
  { value: "open", label: "Open", tone: "amber" as const },
  { value: "in_progress", label: "In progress", tone: "brand" as const },
  { value: "resolved", label: "Resolved", tone: "green" as const },
];

export function statusLabel(v: string): string {
  return ISSUE_STATUSES.find((s) => s.value === v)?.label ?? v;
}

export function statusTone(v: string): "amber" | "brand" | "green" | "neutral" {
  return ISSUE_STATUSES.find((s) => s.value === v)?.tone ?? "neutral";
}
