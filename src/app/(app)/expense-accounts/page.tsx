import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, expenseAccountMappings, fixedLineItems } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { fetchExpenseAccounts, xeroStatus } from "@/lib/xero";
import type { AccountMethod } from "@/lib/expense-accounts";
import { maskAmount, revealState } from "@/lib/sensitive";
import { PageHeader } from "@/components/ui/page";
import { RevealToggle } from "@/components/sensitive-amount";
import { ExpenseAccountsClient } from "./expense-accounts-client";

export const metadata = { title: "Expense Accounts — COLAB" };

export default async function ExpenseAccountsPage() {
  await requirePermission("controls.view");
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "controls.manage") : false;
  const reveal = await revealState();

  const xero = await xeroStatus();
  const result = xero.connected
    ? await fetchExpenseAccounts()
    : ({ ok: false, error: "Not connected to Xero." } as const);

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
    return {
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      type: a.type,
      description: a.description,
      missing: a.missing,
      method: (m?.method ?? null) as AccountMethod | null,
      companyId: m?.companyId ?? null,
      fixedLineItemId: m?.fixedLineItemId ?? null,
      percentages: m?.percentages ?? null,
      sensitive: m?.sensitive ?? false,
      balanceMethod: (m?.balanceMethod ?? null) as AccountMethod | null,
      balanceCompanyId: m?.balanceCompanyId ?? null,
      balancePercentages: m?.balancePercentages ?? null,
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
        companies={subs.map((c) => ({ id: c.id, name: c.name }))}
        fixedItems={items.map((i) => ({
          id: i.id,
          name: i.name,
          splitMode: i.splitMode as "quantity" | "percent",
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
