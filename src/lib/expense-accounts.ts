/**
 * Shared vocabulary for linking a Xero P&L expense account to the way its
 * cost gets recharged to the sub-companies. Imported by both the server
 * action and the client grid, so nothing server-only belongs in here.
 */

export const ACCOUNT_METHODS = [
  "per_sqm",
  "headcount",
  "equal",
  "fixed",
  "direct",
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
  tone: "brand" | "green" | "amber" | "neutral" | "slate" | "indigo";
  /** Whether the row needs an extra pick (a company, or a fixed line item). */
  needs?: "company" | "fixedItem";
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
    description: "Divided by staff count — utilities, cleaning, consumables, coffee.",
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
