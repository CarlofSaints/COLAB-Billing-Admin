/**
 * The two invoice runs, and what they are CALLED on screen.
 *
 * Client-safe on purpose — the toggle on the Invoice Run page needs the label,
 * and `invoice-engine.ts` is `server-only`.
 *
 * The keys stay "recurring" and "month_end" because they are the
 * `invoice_run_type` Postgres enum and every `invoice_runs` row ever written
 * carries one. Renaming an enum value means recreating the type, which takes
 * the column with it. So the name lives here and nowhere else: to rename these
 * again, change this map, not the keys.
 */

export type RunType = "recurring" | "month_end";

export const RUN_TYPE_LABELS: Record<RunType, string> = {
  recurring: "Static",
  month_end: "Variable",
};

export const RUN_TYPES: RunType[] = ["recurring", "month_end"];
