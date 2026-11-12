import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, expenseAccountMappings, fixedLineItems } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { fetchExpenseAccounts, xeroStatus } from "@/lib/xero";
import { recoveryItemIds, type AccountMethod } from "@/lib/expense-accounts";
import { maskAmount, revealState } from "@/lib/sensitive";
import { getMonthCosts } from "@/lib/month-costs";
import { isPeriod, periodOf, recentPeriods } from "@/lib/periods";
import { PageHeader } from "@/components/ui/page";
import { RevealToggle } from "@/components/sensitive-amount";
import { ExpenseAccountsClient } from "./expense-accounts-client";

export const metadata = { title: "Expense Accounts — COLAB" };

export default async function ExpenseAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requirePermission("controls.view");
  const { period: requested } = await searchParams;
  // A double check while setting rules, so it opens on the month in progress.
  // SAST is UTC+2 all year, so 00:30 on the 1st is already the new month.
  const sast = new Date();
  sast.setUTCHours(sast.getUTCHours() + 2);
  const thisMonth = periodOf(sast);
  const periods = recentPeriods(15, sast);
  const period = requested && isPeriod(requested) && periods.includes(requested) ? requested : thisMonth;
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "controls.manage") : false;
  const reveal = await revealState();

  const xero = await xeroStatus();
  const [result, costs] = xero.connected
    ? await Promise.all([fetchExpenseAccounts(), getMonthCosts(period)])
    : ([
        { ok: false, error: "Not connected to Xero." } as const,
        { ok: false, rows: [], error: "Not connected to Xero." } as const,
      ] as const);

  // Same rows Supplier Splits and the invoice run read (journals included).
  const spendByCode = new Map<string, { supplierName: string; amount: number; documents: number }[]>();
  for (const s of costs.rows) {
    const list = spendByCode.get(s.accountCode) ?? [];
    list.push({ supplierName: s.supplierName, amount: s.amount, documents: s.documents });
    spendByCode.set(s.accountCode, list);
  }

  const [subs, items, mappings] = await Promise.all([
    db.select().from(companies).where(eq(companies.type, "sub")).orderBy(asc(companies.name)),
    db
      .select()
      .from(fixedLineItems)
      .where(eq(fixedLineItems.active, true))
      .orderBy(asc(fixedLineItems.name)),
    db.select().from(expenseAccountMappings),
  ]);

  const accounts = result.ok ? result.accounts : [];
  const mapped = new Map(mappings.map((m) => [m.xeroAccountId, m]));

  // Anything mapped that Xero no longer returns (archived, deleted, renamed
  // away) still needs to be visible so it can be cleaned up.
  const orphans = mappings
    .filter((m) => !accounts.some((a) => a.accountId === m.xeroAccountId))
    .map((m) => ({
      accountId: m.xeroAccountId,
      code: m.accountCode,
      name: m.accountName,
      type: m.accountType,
      description: null as string | null,
      missing: true,
    }));

  const rows = [
    ...accounts.map((a) => ({ ...a, missing: false })),
    ...(result.ok ? orphans : []),
  ].map((a) => {
    const m = mapped.get(a.accountId);
    const sensitive = m?.sensitive ?? false;
    const lines = (a.code ? spendByCode.get(a.code) : undefined) ?? [];
    return {
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      type: a.type,
      description: a.description,
      missing: a.missing,
      method: (m?.method ?? null) as AccountMethod | null,
      companyId: m?.companyId ?? null,
      // Through the helper so a row saved before multi-item recovery still
      // shows the item it has always recovered.
      fixedLineItemIds: m ? recoveryItemIds(m) : [],
      percentages: m?.percentages ?? null,
      sensitive: m?.sensitive ?? false,
      balanceMethod: (m?.balanceMethod ?? null) as AccountMethod | null,
      balanceCompanyId: m?.balanceCompanyId ?? null,
      balancePercentages: m?.balancePercentages ?? null,
      // Restricted accounts (salaries) never send their figures out.
      // null = restricted, and then the supplier names stay on the server too.
      amount: lines.length
        ? maskAmount(lines.reduce((t, l) => t + l.amount, 0), sensitive, reveal.unlocked)
        : 0,
      spend: sensitive && !reveal.unlocked ? [] : lines.sort((x, y) => y.amount - x.amount),
    };
  });

  return (
    <div>
      <PageHeader
        title="Expense Accounts"
        description="Link each expense account on the Xero P&L to the way its cost is split across the sub-companies."
        actions={<RevealToggle unlocked={reveal.unlocked} canUnlock={reveal.canUnlock} />}
      />
      <ExpenseAccountsClient
        rows={rows}
        period={period}
        periods={periods}
        // Also set when only the P&L failed: then the journal (payroll) gap is missing.
        spendError={costs.error ?? null}
        companies={subs.map((c) => ({ id: c.id, name: c.name }))}
        fixedItems={items.map((i) => ({
          id: i.id,
          name: i.name,
          splitMode: i.splitMode,
          // A restricted item's amount never leaves the server, not even in a
          // dropdown label.
          unitAmount: maskAmount(Number(i.unitAmount), i.sensitive, reveal.unlocked),
          allocatedTotal: null,
        }))}
        canUnlock={reveal.canUnlock}
        canManage={canManage}
        xero={{ ...xero, error: result.ok ? null : result.error }}
      />
    </div>
  );
}
