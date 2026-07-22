import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceRunInvoices, invoiceRuns } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { buildPreview, type RunType } from "@/lib/invoice-engine";
import { defaultPeriod, isPeriod, recentPeriods } from "@/lib/periods";
import { xeroStatus } from "@/lib/xero";
import { PageHeader } from "@/components/ui/page";
import { InvoiceBuilder } from "./invoices-client";

export const metadata = { title: "Invoice Run — COLAB" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; run?: string }>;
}) {
  await requirePermission("billing.view");
  const user = await getCurrentUser();
  const canRun = user ? hasPermission(user, "billing.run") : false;

  const params = await searchParams;
  const period = params.period && isPeriod(params.period) ? params.period : defaultPeriod();
  const runType: RunType = params.run === "recurring" ? "recurring" : "month_end";

  const xero = await xeroStatus();
  const preview = await buildPreview(period, runType);

  // Anything already sent for this month + run, so a repeat is deliberate.
  const runs = await db
    .select()
    .from(invoiceRuns)
    .where(and(eq(invoiceRuns.period, period), eq(invoiceRuns.runType, runType)))
    .orderBy(desc(invoiceRuns.createdAt));

  const runIds = runs.map((r) => r.id);
  const priorInvoices =
    runIds.length > 0
      ? await db
          .select()
          .from(invoiceRunInvoices)
          .where(eq(invoiceRunInvoices.runId, runIds[0]))
      : [];

  return (
    <div>
      <PageHeader
        title="Invoice Run"
        description="Review what each sub-company will be billed, adjust anything that needs it, then push the invoices to Xero as drafts."
      />
      <InvoiceBuilder
        preview={preview}
        periods={recentPeriods()}
        canRun={canRun}
        xeroConnected={xero.connected}
        previousRun={
          runs[0]
            ? {
                id: runs[0].id,
                createdAt: runs[0].createdAt.toISOString(),
                createdBy: runs[0].createdByName ?? "Someone",
                total: Number(runs[0].total),
                invoices: priorInvoices.map((i) => ({
                  companyName: i.companyName,
                  invoiceNumber: i.xeroInvoiceNumber,
                  error: i.error,
                })),
              }
            : null
        }
        runCount={runs.length}
      />
    </div>
  );
}
