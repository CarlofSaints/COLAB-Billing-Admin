"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, companies, invoiceRunInvoices, invoiceRuns } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { isPeriod, periodLabel } from "@/lib/periods";
import { createDraftInvoice } from "@/lib/xero";
import { DEFAULT_INCOME_ACCOUNT, INCOME_ACCOUNT_KEY } from "@/lib/controls";
import type { RunType } from "@/lib/invoice-engine";

export type GenerateResult = {
  error?: string;
  runId?: number;
  created?: { company: string; invoiceNumber?: string }[];
  failed?: { company: string; error: string }[];
};

type SubmittedInvoice = {
  companyId: number;
  lines: { description: string; amount: number }[];
};

function parseInvoices(raw: FormDataEntryValue | null): SubmittedInvoice[] | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const out: SubmittedInvoice[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    const companyId = Number(r.companyId);
    if (!Number.isInteger(companyId) || companyId <= 0) return null;
    if (!Array.isArray(r.lines)) return null;

    const lines: { description: string; amount: number }[] = [];
    for (const l of r.lines) {
      if (!l || typeof l !== "object") continue;
      const line = l as Record<string, unknown>;
      const description = String(line.description ?? "").trim();
      const amount = Number(line.amount);
      if (!description || !Number.isFinite(amount) || amount === 0) continue;
      lines.push({ description, amount: Math.round(amount * 100) / 100 });
    }
    if (lines.length > 0) out.push({ companyId, lines });
  }
  return out;
}

/** Last day of the billing month, as YYYY-MM-DD. */
function periodEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pushes the previewed invoices to Xero as drafts, exactly as edited on
 * screen. Each company is posted independently so one failure doesn't lose
 * the rest, and every outcome is recorded against the run.
 */
export async function generateInvoices(
  _prev: GenerateResult,
  formData: FormData,
): Promise<GenerateResult> {
  const user = await requirePermission("billing.run");

  const period = String(formData.get("period") ?? "");
  const runType = String(formData.get("runType") ?? "") as RunType;
  if (!isPeriod(period)) return { error: "That billing month isn't valid." };
  if (runType !== "recurring" && runType !== "month_end") {
    return { error: "Unknown run type." };
  }

  const submitted = parseInvoices(formData.get("invoices"));
  if (!submitted) return { error: "Could not read the invoices — reload and try again." };
  if (submitted.length === 0) return { error: "There are no invoice lines to send." };

  const [incomeSetting] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, INCOME_ACCOUNT_KEY))
    .limit(1);
  const incomeAccount = incomeSetting?.value?.trim() || DEFAULT_INCOME_ACCOUNT;

  const subs = await db.select().from(companies).where(eq(companies.type, "sub"));
  const byId = new Map(subs.map((c) => [c.id, c]));

  const date = periodEnd(period);
  const dueDate = addDays(date, 30);
  const reference = `COLAB ${runType === "recurring" ? "recurring" : "month-end"} — ${periodLabel(period)}`;

  const [run] = await db
    .insert(invoiceRuns)
    .values({
      period,
      runType,
      total: submitted
        .reduce((s, i) => s + i.lines.reduce((t, l) => t + l.amount, 0), 0)
        .toFixed(2),
      createdByUserId: user.id,
      createdByName: user.name,
    })
    .returning();

  const created: { company: string; invoiceNumber?: string }[] = [];
  const failed: { company: string; error: string }[] = [];

  for (const item of submitted) {
    const company = byId.get(item.companyId);
    if (!company) continue;
    const total = item.lines.reduce((s, l) => s + l.amount, 0);

    if (!company.xeroContactId) {
      const error = "No Xero contact is linked to this sub-company.";
      failed.push({ company: company.name, error });
      await db.insert(invoiceRunInvoices).values({
        runId: run.id,
        companyId: company.id,
        companyName: company.name,
        total: total.toFixed(2),
        error,
        lines: item.lines,
      });
      continue;
    }

    const res = await createDraftInvoice(
      {
        contactId: company.xeroContactId,
        date,
        dueDate,
        reference,
        lines: item.lines,
      },
      incomeAccount,
    );

    await db.insert(invoiceRunInvoices).values({
      runId: run.id,
      companyId: company.id,
      companyName: company.name,
      total: total.toFixed(2),
      xeroInvoiceId: res.invoiceId ?? null,
      xeroInvoiceNumber: res.invoiceNumber ?? null,
      error: res.ok ? null : (res.error ?? "Unknown error"),
      lines: item.lines,
    });

    if (res.ok) created.push({ company: company.name, invoiceNumber: res.invoiceNumber });
    else failed.push({ company: company.name, error: res.error ?? "Unknown error" });
  }

  await logEvent({
    action: "billing.invoices_generated",
    summary: `Created ${created.length} draft invoice(s) in Xero for ${periodLabel(period)} (${runType === "recurring" ? "recurring" : "month-end"})${failed.length ? `, ${failed.length} failed` : ""}`,
    actor: user,
    entityType: "invoice_run",
    entityId: run.id,
    metadata: { period, runType, created: created.length, failed: failed.length },
  });

  revalidatePath("/invoices");
  return { runId: run.id, created, failed };
}

/** Previous runs for a month, so a second run is a deliberate choice. */
export async function priorRuns(period: string, runType: RunType) {
  await requirePermission("billing.view");
  const runs = await db
    .select()
    .from(invoiceRuns)
    .where(and(eq(invoiceRuns.period, period), eq(invoiceRuns.runType, runType)))
    .orderBy(desc(invoiceRuns.createdAt));
  return runs;
}
