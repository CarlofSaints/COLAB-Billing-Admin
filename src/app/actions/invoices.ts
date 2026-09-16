"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  appSettings,
  companies,
  invoiceRunDrafts,
  invoiceRunInvoices,
  invoiceRuns,
  type SavedInvoiceCompany,
} from "@/db/schema";
import { requirePermission, type SessionUser } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { isPeriod, periodLabel } from "@/lib/periods";
import { createDraftInvoice } from "@/lib/xero";
import { DEFAULT_INCOME_ACCOUNT, INCOME_ACCOUNT_KEY } from "@/lib/controls";
import { RUN_TYPE_LABELS, type RunType } from "@/lib/run-types";

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

/**
 * Reads the editor's full state (keys, blank lines and drill-downs included) so
 * the saved copy reopens exactly as it was left. Null means malformed.
 */
function parseDraft(raw: unknown): SavedInvoiceCompany[] | null {
  if (!Array.isArray(raw) || raw.length > 200) return null;
  const out: SavedInvoiceCompany[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    const companyId = Number(r.companyId);
    if (!Number.isInteger(companyId) || companyId <= 0) return null;
    if (!Array.isArray(r.lines) || r.lines.length > 500) return null;

    const lines: SavedInvoiceCompany["lines"] = [];
    for (const l of r.lines) {
      if (!l || typeof l !== "object") return null;
      const line = l as Record<string, unknown>;
      const key = String(line.key ?? "");
      if (!key) return null;
      const amount = Number(line.amount);
      lines.push({
        key: key.slice(0, 200),
        description: String(line.description ?? "").slice(0, 1000),
        amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
        detail: Array.isArray(line.detail) ? line.detail.slice(0, 50).map((d) => String(d).slice(0, 1000)) : [],
      });
    }
    out.push({ companyId, lines });
  }
  return out;
}

async function upsertDraft(
  period: string,
  runType: RunType,
  draft: SavedInvoiceCompany[],
  calculatedTotal: number,
  user: SessionUser,
) {
  const values = {
    companies: draft,
    calculatedTotal: calculatedTotal.toFixed(2),
    savedByUserId: user.id,
    savedByName: user.name,
    savedAt: new Date(),
  };
  await db
    .insert(invoiceRunDrafts)
    .values({ period, runType, ...values })
    .onConflictDoUpdate({ target: [invoiceRunDrafts.period, invoiceRunDrafts.runType], set: values });
}

export type DraftResult = { ok?: boolean; error?: string };

/**
 * Saves hand edits to an Invoice Run without sending anything to Xero. The page
 * then reopens on these lines instead of the calculated ones.
 */
export async function saveInvoiceDraft(input: {
  period: string;
  runType: RunType;
  companies: unknown;
  calculatedTotal: number;
}): Promise<DraftResult> {
  const user = await requirePermission("billing.run");
  const { period, runType } = input;
  if (!isPeriod(period)) return { error: "That billing month isn't valid." };
  if (runType !== "recurring" && runType !== "month_end") return { error: "Unknown run type." };
  const draft = parseDraft(input.companies);
  if (!draft) return { error: "Could not read the invoice lines — reload and try again." };
  const calculatedTotal = Number(input.calculatedTotal);
  if (!Number.isFinite(calculatedTotal)) return { error: "Could not read the calculated total." };

  await upsertDraft(period, runType, draft, calculatedTotal, user);

  const total = draft.reduce((s, c) => s + c.lines.reduce((t, l) => t + l.amount, 0), 0);
  await logEvent({
    action: "billing.invoice_draft_saved",
    summary: `Saved changes to the ${RUN_TYPE_LABELS[runType]} invoice run for ${periodLabel(period)} (R${total.toFixed(2)})`,
    actor: user,
    entityType: "invoice_run_draft",
    metadata: { period, runType, total, calculatedTotal },
  });

  revalidatePath("/invoices");
  return { ok: true };
}

/** Throws away saved edits so the page goes back to the calculated figures. */
export async function discardInvoiceDraft(input: { period: string; runType: RunType }): Promise<DraftResult> {
  const user = await requirePermission("billing.run");
  const { period, runType } = input;
  if (!isPeriod(period)) return { error: "That billing month isn't valid." };
  if (runType !== "recurring" && runType !== "month_end") return { error: "Unknown run type." };

  const deleted = await db
    .delete(invoiceRunDrafts)
    .where(and(eq(invoiceRunDrafts.period, period), eq(invoiceRunDrafts.runType, runType)))
    .returning({ id: invoiceRunDrafts.id });

  if (deleted.length > 0) {
    await logEvent({
      action: "billing.invoice_draft_discarded",
      summary: `Discarded saved changes to the ${RUN_TYPE_LABELS[runType]} invoice run for ${periodLabel(period)}`,
      actor: user,
      entityType: "invoice_run_draft",
      metadata: { period, runType },
    });
  }

  revalidatePath("/invoices");
  return { ok: true };
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

  // What went to Xero is kept as the saved copy, so the page doesn't snap back
  // to the calculated figures when it re-renders after sending.
  const draftRaw = formData.get("draft");
  if (typeof draftRaw === "string") {
    let draft: SavedInvoiceCompany[] | null = null;
    try {
      draft = parseDraft(JSON.parse(draftRaw));
    } catch {
      draft = null;
    }
    const calculatedTotal = Number(formData.get("calculatedTotal"));
    if (draft && Number.isFinite(calculatedTotal)) {
      await upsertDraft(period, runType, draft, calculatedTotal, user);
    }
  }

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
  // Goes onto the Xero draft as its Reference, so this is the one place the run
  // type's name leaves the app. Was "COLAB recurring" / "COLAB month-end".
  const reference = `COLAB ${RUN_TYPE_LABELS[runType]} — ${periodLabel(period)}`;

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
    summary: `Created ${created.length} draft invoice(s) in Xero for ${periodLabel(period)} (${RUN_TYPE_LABELS[runType]})${failed.length ? `, ${failed.length} failed` : ""}`,
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
