import { asc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  companies,
  expenseAccountMappings,
  fixedLineAllocations,
  fixedLineItems,
  supplierSplits,
} from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { fetchExpenseAccounts, xeroStatus } from "@/lib/xero";
import { getMonthCosts } from "@/lib/month-costs";
import { fixedItemTotal } from "@/lib/billing-calc";
import { maskAmount, revealState } from "@/lib/sensitive";
import { RevealToggle } from "@/components/sensitive-amount";
import { defaultPeriod, isPeriod, recentPeriods } from "@/lib/periods";
import type { AccountMethod } from "@/lib/expense-accounts";
import { PageHeader } from "@/components/ui/page";
import { SupplierSplitsClient, type SupplierRow } from "./supplier-splits-client";

export const metadata = { title: "Supplier Splits — COLAB" };

export default async function SupplierSplitsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requirePermission("controls.view");
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "controls.manage") : false;

  const reveal = await revealState();
  const { period: requested } = await searchParams;
  const period = requested && isPeriod(requested) ? requested : defaultPeriod();

  const xero = await xeroStatus();
  const [costs, accountList] = xero.connected
    ? await Promise.all([getMonthCosts(period), fetchExpenseAccounts()])
    : [
        {
          ok: false,
          rows: [],
          hiddenNonExpense: 0,
          reconciled: false,
          journalTotal: 0,
          error: "Not connected to Xero.",
        } as const,
        { ok: false, error: "" } as const,
      ];

  const [subs, items, allocations, thisMonth, earlier, accountDefaults] = await Promise.all([
    db.select().from(companies).where(eq(companies.type, "sub")).orderBy(asc(companies.name)),
    db
      .select()
      .from(fixedLineItems)
      .where(eq(fixedLineItems.active, true))
      .orderBy(asc(fixedLineItems.name)),
    db.select().from(fixedLineAllocations),
    db.select().from(supplierSplits).where(eq(supplierSplits.period, period)),
    // Every earlier decision, newest first — the first hit per supplier+account
    // is the one a month with no explicit split inherits.
    db
      .select()
      .from(supplierSplits)
      .where(lt(supplierSplits.period, period))
      .orderBy(asc(supplierSplits.period)),
    db.select().from(expenseAccountMappings),
  ]);

  const accountName = new Map(
    (accountList.ok ? accountList.accounts : []).map((a) => [a.code ?? "", a.name]),
  );
  const accountDefaultByCode = new Map(
    accountDefaults
      .filter((m) => m.accountCode)
      .map((m) => [m.accountCode!, m]),
  );

  const explicit = new Map(thisMonth.map((r) => [`${r.accountCode}|${r.xeroContactId}`, r]));
  // Ordered oldest→newest, so later writes overwrite earlier ones and we end
  // up holding the most recent prior decision for each combination.
  const inherited = new Map<string, (typeof earlier)[number]>();
  for (const r of earlier) inherited.set(`${r.accountCode}|${r.xeroContactId}`, r);

  const spendRows = costs.rows;
  const hiddenNonExpense = costs.hiddenNonExpense;

  const rows: SupplierRow[] = spendRows.map((s) => {
    const own = explicit.get(s.key);
    const prior = inherited.get(s.key);
    const accountDefault = accountDefaultByCode.get(s.accountCode);

    let source: SupplierRow["source"] = "unset";
    let method: AccountMethod | null = null;
    let companyId: number | null = null;
    let fixedLineItemId: number | null = null;
    let percentages: { companyId: number; percent: number }[] | null = null;
    let inheritedFrom: string | null = null;

    const winner = own ?? prior ?? accountDefault ?? null;
    if (own) source = "explicit";
    else if (prior) source = "inherited";
    else if (accountDefault) source = "account";

    if (winner) {
      method = winner.method;
      companyId = winner.companyId;
      fixedLineItemId = winner.fixedLineItemId;
      percentages = winner.percentages ?? null;
    }
    if (!own && prior) inheritedFrom = prior.period;

    return {
      key: s.key,
      accountCode: s.accountCode,
      accountName: accountName.get(s.accountCode) ?? null,
      contactId: s.contactId,
      supplierName: s.supplierName,
      // Accounts marked restricted (salaries) never send their figures out.
      amount: maskAmount(s.amount, accountDefault?.sensitive ?? false, reveal.unlocked),
      documents: s.documents,
      method,
      companyId,
      fixedLineItemId,
      percentages,
      // Balance decisions only live on supplier rows — an account default has
      // no notion of the shortfall on one supplier's invoice.
      balanceMethod: ((own ?? prior)?.balanceMethod ?? null) as AccountMethod | null,
      balanceCompanyId: (own ?? prior)?.balanceCompanyId ?? null,
      balancePercentages: (own ?? prior)?.balancePercentages ?? null,
      source,
      inheritedFrom,
    };
  });

  return (
    <div>
      <PageHeader
        title="Supplier Splits"
        description="Split individual suppliers within an expense account. Anything you don't set carries forward from the month before."
        actions={<RevealToggle unlocked={reveal.unlocked} canUnlock={reveal.canUnlock} />}
      />
      <SupplierSplitsClient
        period={period}
        periods={recentPeriods()}
        rows={rows}
        companies={subs.map((c) => ({ id: c.id, name: c.name }))}
        fixedItems={items.map((i) => ({
          id: i.id,
          name: i.name,
          unitAmount: Number(i.unitAmount),
          // What the item's per-company shares actually recover.
          allocatedTotal: fixedItemTotal(
            { splitMode: i.splitMode, unitAmount: Number(i.unitAmount) },
            allocations.filter((a) => a.fixedLineItemId === i.id).map((a) => Number(a.quantity)),
          ),
        }))}
        canManage={canManage}
        canUnlock={reveal.canUnlock}
        hiddenNonExpense={hiddenNonExpense}
        xero={{
          connected: xero.connected,
          tenantName: xero.tenantName,
          error: costs.ok ? null : (costs.error ?? null),
        }}
      />
    </div>
  );
}
