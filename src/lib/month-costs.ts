import "server-only";
import {
  fetchExpenseAccounts,
  fetchProfitAndLoss,
  fetchSupplierSpend,
  type SupplierSpendRow,
} from "./xero";

/**
 * The full cost picture for a billing month: what each supplier spent on each
 * expense account, plus — crucially — whatever the P&L shows that no supplier
 * document accounts for.
 *
 * That gap is real money. Payroll runs through Sage and reaches Xero as a
 * journal, and journals are invisible to the invoice/bank endpoints. Without
 * this reconciliation the shared cleaning and reception salaries would never
 * be recharged.
 */

/** Sentinel "supplier" for costs that came from journals rather than a document. */
export const JOURNAL_CONTACT_ID = "__journal__";
export const JOURNAL_SUPPLIER_NAME = "Journals & adjustments";

export type MonthCosts = {
  ok: boolean;
  rows: SupplierSpendRow[];
  /** Supplier lines dropped because they hit balance-sheet accounts. */
  hiddenNonExpense: number;
  /** True when the P&L could be read and the reconciliation is trustworthy. */
  reconciled: boolean;
  /** Total value of the synthesised journal rows. */
  journalTotal: number;
  error?: string;
};

export async function getMonthCosts(period: string): Promise<MonthCosts> {
  const [spend, accountList, pl] = await Promise.all([
    fetchSupplierSpend(period),
    fetchExpenseAccounts(),
    fetchProfitAndLoss(period),
  ]);

  if (!spend.ok) {
    return {
      ok: false,
      rows: [],
      hiddenNonExpense: 0,
      reconciled: false,
      journalTotal: 0,
      error: spend.error,
    };
  }

  const accounts = accountList.ok ? accountList.accounts : [];
  const expenseCodes = new Set(accounts.map((a) => a.code).filter(Boolean) as string[]);
  const codeByAccountId = new Map(accounts.map((a) => [a.accountId, a.code ?? ""]));

  // Supplier payments also hit balance-sheet accounts (PAYE, salary control,
  // loans), which can never be recharged.
  const supplierRows =
    expenseCodes.size > 0
      ? spend.rows.filter((r) => expenseCodes.has(r.accountCode))
      : spend.rows;
  const hiddenNonExpense = spend.rows.length - supplierRows.length;

  if (!pl.ok) {
    return {
      ok: true,
      rows: supplierRows,
      hiddenNonExpense,
      reconciled: false,
      journalTotal: 0,
      error: pl.error,
    };
  }

  // What the documents account for, per expense account.
  const documented = new Map<string, number>();
  for (const r of supplierRows) {
    documented.set(r.accountCode, (documented.get(r.accountCode) ?? 0) + r.amount);
  }

  const journalRows: SupplierSpendRow[] = [];
  let journalTotal = 0;

  const plByCode = new Map<string, number>();
  for (const [accountId, plAmount] of pl.byAccountId) {
    const code = codeByAccountId.get(accountId);
    if (!code || !expenseCodes.has(code)) continue; // revenue or balance sheet
    plByCode.set(code, (plByCode.get(code) ?? 0) + plAmount);
  }

  // Every expense account the P&L or the documents touch — an account can
  // appear in one and not the other, and both directions matter.
  const allCodes = new Set([...plByCode.keys(), ...documented.keys()]);
  for (const code of allCodes) {
    const variance =
      Math.round(((plByCode.get(code) ?? 0) - (documented.get(code) ?? 0)) * 100) / 100;
    if (Math.abs(variance) < 0.01) continue;

    journalRows.push({
      key: `${code}|${JOURNAL_CONTACT_ID}`,
      accountCode: code,
      contactId: JOURNAL_CONTACT_ID,
      supplierName: JOURNAL_SUPPLIER_NAME,
      amount: variance,
      documents: 0,
    });
    journalTotal += variance;
  }

  const rows = [...supplierRows, ...journalRows].sort(
    (a, b) => Math.abs(b.amount) - Math.abs(a.amount),
  );

  return { ok: true, rows, hiddenNonExpense, reconciled: true, journalTotal };
}
