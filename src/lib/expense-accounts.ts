/**
 * Shared vocabulary for linking a Xero P&L expense account to the way its
 * cost gets recharged to the sub-companies. Imported by both the server
 * action and the client grid, so nothing server-only belongs in here.
 */

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
      "Already billed from Controls — rent on the recurring invoice, or a fixed line item. Ignored here so it can't go out twice.",
    tone: "indigo",
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

export type PercentEntry = { companyId: number; percent: number };

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
    out.push({ companyId, percent });
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
    .map((e) => `${companyName(e.companyId)} ${e.percent}%`)
    .join(" · ");
}

export type FixedItemOption = {
  id: number;
  name: string;
  splitMode: "quantity" | "percent";
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
  return item.splitMode === "percent"
    ? `${item.name} · ${format(item.unitAmount)} total, split by %`
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
