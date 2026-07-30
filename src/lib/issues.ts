// Shared vocabulary for office issue tickets. Plain constants — client + server.
//
// The issue TYPES used to live here as a hard-coded list. They're now rows in
// `issue_categories`, managed from "Manage types & places" on /issues, so that
// adding one like "Something is finished" doesn't need a deploy — see
// `src/lib/issue-lists.ts`. Places live alongside them in `issue_places`.
//
// Statuses stay here on purpose: each one has behaviour attached (resolving
// stamps `resolvedByName`/`resolvedAt`), so a new one is a code change anyway.

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
