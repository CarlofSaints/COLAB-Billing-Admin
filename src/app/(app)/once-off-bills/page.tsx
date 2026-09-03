import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailGroups } from "@/db/schema";
import { getCurrentUser, hasPermission, requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { isPeriod, periodLabel, recentPeriods } from "@/lib/periods";
import { loadSplitBasis } from "@/lib/split-basis";
import {
  billQuantity,
  billableCompanies,
  billTotal,
  loadOnceOffBills,
  resolveBillLines,
} from "@/lib/once-off-bills";
import { notificationChoices, notificationPerson } from "@/lib/notifications";
import { resolveGroupRecipients } from "@/lib/group-members";
import { OnceOffBillsClient } from "./once-off-bills-client";

export const metadata = { title: "Once-off Bills — COLAB" };

/**
 * The months a bill can be raised for.
 *
 * `recentPeriods()` is the past 15 months, which is right for the Invoice Run
 * (you bill a month that has closed) and wrong here — a once-off bill is
 * usually raised for the month you are IN, or the next one. So the list is the
 * recent months plus the next three.
 */
function billingMonths(): string[] {
  const now = new Date();
  const ahead: string[] = [];
  for (let i = 3; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    ahead.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return [...ahead, ...recentPeriods(12)];
}

export default async function OnceOffBillsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requirePermission("billing.view");
  const user = await getCurrentUser();
  // Saving, copying, submitting and deleting all change what a sub-company is
  // billed, so they take the same permission as generating the run itself.
  const canManage = user ? hasPermission(user, "billing.run") : false;

  const params = await searchParams;
  const filterPeriod = params.period && isPeriod(params.period) ? params.period : null;

  const [{ basis }, companies, bills] = await Promise.all([
    loadSplitBasis(),
    billableCompanies(),
    loadOnceOffBills(filterPeriod ? { period: filterPeriod } : undefined),
  ]);

  // Priced on the server with the SAME function the invoice run uses, so the
  // number on this page is the number that lands on the invoice. Working it
  // out again in the client would be a second implementation waiting to drift.
  const priced = bills.map((b) => {
    const lines = resolveBillLines(b, basis);
    return {
      id: b.id,
      description: b.description,
      period: b.period,
      periodLabel: periodLabel(b.period),
      splitMode: b.splitMode,
      unitAmount: b.unitAmount,
      notes: b.notes,
      status: b.status,
      createdByName: b.createdByName,
      submittedAt: b.submittedAt ? b.submittedAt.toISOString() : null,
      submittedByName: b.submittedByName,
      copiedFromId: b.copiedFromId,
      createdAt: b.createdAt.toISOString(),
      quantity: billQuantity(b),
      total: billTotal(b, basis),
      allocations: b.allocations,
      lines: lines.map((l) => ({
        companyId: l.companyId,
        share: l.share,
        amount: l.amount,
      })),
    };
  });

  /**
   * Who a submission would actually email, worked out now rather than after
   * the fact. An empty notification group is the failure this page is most
   * likely to have — it looks configured and tells nobody — so the answer is
   * on screen before anyone presses Submit.
   */
  const choice = (await notificationChoices()).onceoff_bill_submitted;
  let groupName: string | null = null;
  let recipientCount = 0;
  if (choice.groupId) {
    const [g] = await db
      .select({ name: emailGroups.name })
      .from(emailGroups)
      .where(eq(emailGroups.id, choice.groupId))
      .orderBy(asc(emailGroups.name))
      .limit(1);
    groupName = g?.name ?? null;
    recipientCount = (await resolveGroupRecipients([choice.groupId])).length;
  }
  const person = choice.personId ? await notificationPerson(choice.personId) : null;

  return (
    <div>
      <PageHeader
        title="Once-off Bills"
        description="A cost that happens once, in one month. Save it as a draft while you work it out, then submit it to add it to that month's Variable invoice run."
      />
      <OnceOffBillsClient
        bills={priced}
        companies={companies}
        basis={{ area: basis.area, headcount: basis.headcount }}
        months={billingMonths()}
        filterPeriod={filterPeriod}
        canManage={canManage}
        notify={{
          groupName,
          recipientCount,
          personName: person?.name ?? null,
        }}
      />
    </div>
  );
}
