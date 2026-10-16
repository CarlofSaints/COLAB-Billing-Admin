/**
 * Shared vocabulary for linking a Xero P&L expense account to the way its
 * cost gets recharged to the sub-companies. Imported by both the server
 * action and the client grid, so nothing server-only belongs in here.
 */

import { fixedSplitModeLabel, isPercentShaped } from "./billing-calc";
import type { FixedSplitMode } from "./billing-calc";

export const ACCOUNT_METHODS = [
  "per_sqm",
  "headcount",
  "equal",
  "percent",
  "fixed",
  "direct",
  "controls",
  "exclude",
] as const;

export type AccountMethod = (typeof ACCOUNT_METHODS)[number];

/** What the grid shows for an account with no mapping row yet. */
export const UNMAPPED = "unmapped" as const;

export type MethodChoice = AccountMethod | typeof UNMAPPED;

export type MethodDef = {
  key: AccountMethod;
  label: string;
  short: string;
  description: string;
  /** Badge tone used in the grid + filter pills. */
  tone: "brand" | "green" | "amber" | "neutral" | "slate" | "indigo" | "violet";
  /** Whether the row needs an extra pick (a company, a fixed item, or percentages). */
  needs?: "company" | "fixedItem" | "percentages";
  /** Shown in the "Applies to" column when the method takes no extra pick. */
  applies?: string;
};

export const METHODS: MethodDef[] = [
  {
    key: "per_sqm",
    label: "Split per m²",
    short: "Per m²",
    description: "Divided by each company's effective floor-space share — rent, rates, security.",
    tone: "brand",
  },
  {
    key: "headcount",
    label: "Split per head",
    short: "Headcount",
    description: "Divided by team member count — utilities, cleaning, consumables, coffee.",
    tone: "green",
  },
  {
    key: "equal",
    label: "Split equally",
    short: "Equal",
    description:
      "An even share each — every sub-company carries the same amount, whatever its size or headcount.",
    tone: "indigo",
    applies: "Every sub-company, evenly",
  },
  {
    key: "percent",
    label: "Split by custom %",
    short: "Custom %",
    description:
      "You set the share each sub-company carries — for costs that follow neither space nor headcount. Must total 100%.",
    tone: "violet",
    needs: "percentages",
  },
  {
    key: "fixed",
    label: "Fixed line item",
    short: "Fixed",
    description: "Recovered through a fixed line item at a set price per unit, e.g. parking bays.",
    tone: "amber",
    needs: "fixedItem",
  },
  {
    key: "direct",
    label: "Direct to one company",
    short: "Direct",
    description: "The whole cost belongs to a single sub-company and is billed straight to it.",
    tone: "slate",
    needs: "company",
  },
  {
    key: "controls",
    label: "Ignore — split in Controls",
    short: "In Controls",
    description:
      "Already billed from Controls — rent on the Static invoice, or fixed line items. Name the items that cover it and anything left over is split here; name none and the whole cost is ignored, so it can't go out twice.",
    tone: "indigo",
    needs: "fixedItem",
    applies: "Billed from Controls",
  },
  {
    key: "exclude",
    label: "Not recharged",
    short: "Excluded",
    description: "COLAB's own cost — never appears on a sub-company invoice.",
    tone: "neutral",
  },
];

export const METHOD_BY_KEY: Record<AccountMethod, MethodDef> = Object.fromEntries(
  METHODS.map((m) => [m.key, m]),
) as Record<AccountMethod, MethodDef>;

export function isAccountMethod(value: string): value is AccountMethod {
  return (ACCOUNT_METHODS as readonly string[]).includes(value);
}

/** `usage` (e.g. pages printed) is set when the percentages were worked out from it. */
export type PercentEntry = { companyId: number; percent: number; usage?: number };

/**
 * Percentages to 2 decimals from each company's usage, by largest remainder so
 * they always total exactly 100. Null when there is no usage to divide.
 */
export function usagePercentages(usage: number[]): number[] | null {
  const safe = usage.map((u) => (Number.isFinite(u) && u > 0 ? u : 0));
  const total = safe.reduce((s, u) => s + u, 0);
  if (total <= 0) return null;
  const exact = safe.map((u) => (u / total) * 10000);
  const out = exact.map(Math.floor);
  let left = 10000 - out.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out.map((v) => v / 100);
}

/**
 * The two methods that recover fixed line items before splitting what's left.
 *
 * They differ only in what "no items named" means: `fixed` without an item
 * recovers nothing (and warns), while `controls` without an item is the
 * original "this is billed from Controls, ignore the whole thing" — which is
 * what rent still uses. With items named they behave identically.
 */
export function recoversFixedItems(method: AccountMethod): boolean {
  return method === "fixed" || method === "controls";
}

/**
 * Every fixed line item a rule recovers.
 *
 * ⚠️ The ONLY way to read a recovery rule. `fixedLineItemIds` is the source of
 * truth; the old single `fixedLineItemId` is a fallback so a row written
 * before the multi-item migration still recovers what it always did. Reading
 * the scalar directly silently under-recovers a multi-item rule by every item
 * after the first.
 */
export function recoveryItemIds(row: {
  fixedLineItemIds?: number[] | null;
  fixedLineItemId?: number | null;
}): number[] {
  const many = row.fixedLineItemIds;
  if (Array.isArray(many) && many.length > 0) {
    // Deduped: the same item must never be counted twice against one bill.
    return [...new Set(many.filter((n) => Number.isInteger(n) && n > 0))];
  }
  return row.fixedLineItemId != null ? [row.fixedLineItemId] : [];
}

/** Reads a `number[]` of item ids off an untrusted JSON payload. */
export function parseItemIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out = value.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(out)];
}

/**
 * Methods offered for the leftover balance when a fixed line item recovers
 * less than the supplier actually charged. "fixed" is excluded — the fixed
 * item is precisely what left the balance behind.
 */
export const BALANCE_METHODS = METHODS.filter(
  (m) => m.key !== "fixed" && m.key !== "controls",
);

/** Reads a `[{companyId, percent}]` array off an untrusted JSON payload. */
export function parsePercentages(value: unknown): PercentEntry[] | null {
  if (!Array.isArray(value)) return null;
  const out: PercentEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const companyId = Number(r.companyId);
    const percent = Number(r.percent);
    if (!Number.isInteger(companyId) || companyId <= 0) continue;
    if (!Number.isFinite(percent) || percent <= 0) continue;
    const usage = Number(r.usage);
    out.push(r.usage != null && Number.isFinite(usage) && usage > 0 ? { companyId, percent, usage } : { companyId, percent });
  }
  return out.length > 0 ? out : null;
}

/** Percentages are only valid once they add up to 100. */
export function percentagesValid(entries: PercentEntry[] | null | undefined): boolean {
  if (!entries || entries.length === 0) return false;
  const sum = entries.reduce((s, e) => s + (Number(e.percent) || 0), 0);
  return Math.abs(sum - 100) < 0.01;
}

export function percentSummary(
  entries: PercentEntry[] | null | undefined,
  companyName: (id: number) => string,
): string {
  if (!entries || entries.length === 0) return "";
  return entries
    .filter((e) => e.percent > 0)
    .map((e) => `${companyName(e.companyId)} ${e.percent}%${e.usage ? ` (${e.usage})` : ""}`)
    .join(" · ");
}

export type FixedItemOption = {
  id: number;
  name: string;
  splitMode: FixedSplitMode;
  /** null when the item's amount is restricted for this viewer. */
  unitAmount: number | null;
  allocatedTotal: number | null;
};

/**
 * How a fixed line item reads in a dropdown. A restricted item shows its name
 * only — the amount must not leak through the option label.
 */
export function fixedItemLabel(
  item: FixedItemOption,
  format: (n: number) => string,
): string {
  if (item.unitAmount === null) return `${item.name} · restricted`;
  return isPercentShaped(item.splitMode)
    ? `${item.name} · ${format(item.unitAmount)} total, ${fixedSplitModeLabel(item.splitMode).toLowerCase()}`
    : `${item.name} · ${format(item.unitAmount)} each`;
}

/** Friendly label for a Xero account type (EXPENSE, OVERHEADS, DIRECTCOSTS, …). */
export function accountTypeLabel(type: string | null | undefined): string {
  if (!type) return "Expense";
  const map: Record<string, string> = {
    EXPENSE: "Expense",
    OVERHEADS: "Overhead",
    DIRECTCOSTS: "Direct cost",
    DEPRECIATN: "Depreciation",
    CURRLIAB: "Current liability",
  };
  return map[type] ?? type.charAt(0) + type.slice(1).toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Which invoice a rule lands on                                        */
/* ------------------------------------------------------------------ */

/** The two invoice runs, as the screens name them (see lib/run-types.ts). */
export type InvoiceSide = "static" | "variable";

/**
 * Which invoice(s) a split rule puts its cost on. Mirrors `buildPreview`:
 *
 * - Items named on "Fixed" / "Ignore — split in Controls" are billed on the
 *   STATIC run, and "In Controls" with no items is billed there whole (rent).
 * - A leftover balance with a split method goes on the VARIABLE run.
 * - Every plain split (per m², head, equal, %, direct) is VARIABLE.
 * - "Not recharged" and an unset rule are on neither.
 *
 * A row can be on both: its items went out on Static, its balance goes out on
 * Variable. That is exactly the row worth seeing from both sides.
 */
export function invoiceSides(rule: {
  method: MethodChoice;
  balanceMethod: MethodChoice | null;
}): { static: boolean; variable: boolean } {
  const { method, balanceMethod } = rule;
  if (method === UNMAPPED || method === "exclude") return { static: false, variable: false };
  if (recoversFixedItems(method)) {
    const splitsBalance =
      balanceMethod != null &&
      balanceMethod !== UNMAPPED &&
      balanceMethod !== "exclude" &&
      !recoversFixedItems(balanceMethod);
    return { static: true, variable: splitsBalance };
  }
  return { static: false, variable: true };
}

export function onInvoice(
  sides: { static: boolean; variable: boolean },
  filter: InvoiceSide | "all",
): boolean {
  return filter === "all" || sides[filter];
}
