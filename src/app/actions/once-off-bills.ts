"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { onceOffBillAllocations, onceOffBills, users } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { isPeriod, periodLabel } from "@/lib/periods";
import {
  FIXED_SPLIT_MODES,
  fixedSplitModeLabel,
  isDerivedMode,
  isPercentShaped,
  type FixedSplitMode,
} from "@/lib/billing-calc";
import { loadSplitBasis } from "@/lib/split-basis";
import {
  billQuantity,
  billTotal,
  loadOnceOffBill,
  resolveBillLines,
} from "@/lib/once-off-bills";
import { notificationRecipients } from "@/lib/notifications";
import { onceOffBillSubmittedEmail } from "@/lib/email-templates";
import {
  appBaseUrl,
  describeProviders,
  sendMail,
  type MailProvider,
} from "@/lib/mailer";
import { billableCompanies } from "@/lib/once-off-bills";
import { formatCurrency } from "@/lib/utils";

export type BillState = { error?: string; ok?: boolean; billId?: number; note?: string };

/**
 * A submitted bill shows up on the Variable invoice preview, so every write
 * here can change what a sub-company is billed. That is the same blast radius
 * as generating a run, so it takes the same permission — `billing.run`, which
 * today is Super Admin and Finance. `billing.view` (which Directors also hold)
 * is enough to READ the page.
 */
const MANAGE = "billing.run";

function revalidateBillPaths() {
  revalidatePath("/once-off-bills");
  // The Variable preview and the dashboard both read submitted bills.
  revalidatePath("/invoices");
  revalidatePath("/");
}

/* ------------------------------------------------------------------ */
/* Parsing the form                                                   */
/* ------------------------------------------------------------------ */

type ParsedBill = {
  description: string;
  period: string;
  splitMode: FixedSplitMode;
  unitAmount: number;
  notes: string | null;
  allocations: { companyId: number; quantity: number }[];
};

/**
 * Reads and validates the add/edit form.
 *
 * Mirrors `saveFixedItem` in controls.ts field for field, including storing 0
 * for the derived modes: a saved copy of today's percentage would look
 * authoritative and be wrong the moment anyone moves desk or joins.
 */
async function parseBill(formData: FormData): Promise<ParsedBill | { error: string }> {
  const description = String(formData.get("description") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();
  const unitAmount = Number(formData.get("unitAmount") || 0);
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const rawMode = String(formData.get("splitMode") ?? "");
  const splitMode: FixedSplitMode = FIXED_SPLIT_MODES.some((m) => m.key === rawMode)
    ? (rawMode as FixedSplitMode)
    : "quantity";

  if (!description) return { error: "Give the bill a description." };
  if (description.length > 200) return { error: "Keep the description under 200 characters." };
  if (!isPeriod(period)) return { error: "Pick the month this should be invoiced in." };
  if (!Number.isFinite(unitAmount) || unitAmount < 0) {
    return { error: "Enter a valid amount." };
  }
  if (unitAmount === 0) return { error: "A bill of R0.00 would put nothing on an invoice." };

  const submittedIds = formData
    .getAll("companyId")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (submittedIds.length === 0) return { error: "Assign at least one sub-company." };

  // Only real, active sub-companies. A stale id in the form would otherwise
  // create an allocation whose company never appears on any invoice, so the
  // bill would quietly total less than it says it does.
  const valid = new Set((await billableCompanies()).map((c) => c.id));
  const unknown = submittedIds.filter((id) => !valid.has(id));
  if (unknown.length > 0) {
    return { error: "One of the sub-companies is no longer active — reload and try again." };
  }
  const companyIds = submittedIds;

  const derived = isDerivedMode(splitMode);
  const allocations = companyIds.map((cid) => {
    if (derived) return { companyId: cid, quantity: 0 };
    const q = Number(formData.get(`qty_${cid}`));
    return { companyId: cid, quantity: Number.isFinite(q) && q >= 0 ? q : 1 };
  });

  if (splitMode === "percent") {
    const sum = allocations.reduce((s, a) => s + a.quantity, 0);
    if (Math.abs(sum - 100) > 0.01) {
      return { error: `Percentages must add up to 100% (currently ${sum.toFixed(2)}%).` };
    }
  }

  if (splitMode === "quantity" && allocations.every((a) => a.quantity === 0)) {
    return { error: "Every quantity is zero, so this bill would charge nothing." };
  }

  if (splitMode === "direct" && companyIds.length !== 1) {
    return { error: "A direct split goes to exactly one sub-company — tick just the one." };
  }

  return { description, period, splitMode, unitAmount, notes, allocations };
}

/** Replaces a bill's allocation set. */
async function writeAllocations(
  billId: number,
  allocations: { companyId: number; quantity: number }[],
) {
  await db.delete(onceOffBillAllocations).where(eq(onceOffBillAllocations.onceOffBillId, billId));
  await db.insert(onceOffBillAllocations).values(
    allocations.map((a) => ({
      onceOffBillId: billId,
      companyId: a.companyId,
      quantity: a.quantity.toFixed(2),
    })),
  );
}

/* ------------------------------------------------------------------ */
/* Save (create or edit a draft)                                      */
/* ------------------------------------------------------------------ */

/**
 * Saving does exactly one thing: it stores the bill as a draft.
 *
 * Nothing is emailed, nothing reaches an invoice. That is the whole point of
 * the two-step — you can build next month's bill, get the quantities wrong,
 * come back tomorrow and fix them, and no client sees any of it.
 */
export async function saveOnceOffBill(
  _prev: BillState,
  formData: FormData,
): Promise<BillState> {
  const user = await requirePermission(MANAGE);
  const id = formData.get("id") ? Number(formData.get("id")) : null;

  const parsed = await parseBill(formData);
  if ("error" in parsed) return { error: parsed.error };

  if (id) {
    const existing = await loadOnceOffBill(id);
    if (!existing) return { error: "That bill no longer exists." };
    // A submitted bill is on a preview that somebody may already have pushed
    // to Xero. Editing it would change a billed amount with no trace, so the
    // way to correct one is to delete it and submit a replacement.
    if (existing.status === "submitted") {
      return {
        error:
          "This bill has already been submitted, so it can't be edited. Copy it, change the copy, and delete this one if it was wrong.",
      };
    }

    await db
      .update(onceOffBills)
      .set({
        description: parsed.description,
        period: parsed.period,
        splitMode: parsed.splitMode,
        unitAmount: parsed.unitAmount.toFixed(2),
        notes: parsed.notes,
        updatedAt: new Date(),
      })
      .where(eq(onceOffBills.id, id));
    await writeAllocations(id, parsed.allocations);

    await logEvent({
      action: "onceoff.updated",
      summary: `Updated the once-off bill "${parsed.description}" for ${periodLabel(parsed.period)}`,
      actor: user,
      entityType: "once_off_bill",
      entityId: id,
      metadata: { period: parsed.period, unitAmount: parsed.unitAmount },
    });
    revalidateBillPaths();
    return { ok: true, billId: id, note: "Saved as a draft. Nothing has been invoiced yet." };
  }

  const [row] = await db
    .insert(onceOffBills)
    .values({
      description: parsed.description,
      period: parsed.period,
      splitMode: parsed.splitMode,
      unitAmount: parsed.unitAmount.toFixed(2),
      notes: parsed.notes,
      status: "draft",
      createdByUserId: user.id,
      createdByName: user.name,
      createdByEmail: user.email,
    })
    .returning();
  await writeAllocations(row.id, parsed.allocations);

  await logEvent({
    action: "onceoff.created",
    summary: `Created the once-off bill "${parsed.description}" for ${periodLabel(parsed.period)}`,
    actor: user,
    entityType: "once_off_bill",
    entityId: row.id,
    metadata: { period: parsed.period, unitAmount: parsed.unitAmount },
  });
  revalidateBillPaths();
  return { ok: true, billId: row.id, note: "Saved as a draft. Nothing has been invoiced yet." };
}

/* ------------------------------------------------------------------ */
/* Copy                                                               */
/* ------------------------------------------------------------------ */

/**
 * Duplicates a bill as a fresh draft, defaulting to the month after the
 * original. That is the repeat-it-next-month workflow: copy, change the
 * quantities, save, submit.
 *
 * The copy is always a DRAFT, whatever the original was — copying something
 * straight onto an invoice is not what anybody means by "copy".
 */
export async function copyOnceOffBill(billId: number): Promise<BillState> {
  const user = await requirePermission(MANAGE);
  const source = await loadOnceOffBill(billId);
  if (!source) return { error: "That bill no longer exists." };

  const [y, m] = source.period.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  const period = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;

  const [row] = await db
    .insert(onceOffBills)
    .values({
      description: source.description,
      period,
      splitMode: source.splitMode,
      unitAmount: source.unitAmount.toFixed(2),
      notes: source.notes,
      status: "draft",
      createdByUserId: user.id,
      createdByName: user.name,
      createdByEmail: user.email,
      copiedFromId: source.id,
    })
    .returning();
  await writeAllocations(row.id, source.allocations);

  await logEvent({
    action: "onceoff.copied",
    summary: `Copied the once-off bill "${source.description}" to ${periodLabel(period)}`,
    actor: user,
    entityType: "once_off_bill",
    entityId: row.id,
    metadata: { copiedFrom: source.id, period },
  });
  revalidateBillPaths();
  return {
    ok: true,
    billId: row.id,
    note: `Copied to ${periodLabel(period)} as a draft. Change what you need, then submit it.`,
  };
}

/* ------------------------------------------------------------------ */
/* Delete                                                             */
/* ------------------------------------------------------------------ */

/**
 * Deletes a bill. Allowed on a submitted one, because that is the ONLY way to
 * undo a submission — but the log records what it was worth, since removing it
 * changes the Variable total for that month.
 *
 * ⚠️ It does NOT touch invoices already pushed to Xero. If the run has been
 * generated, the draft in Xero still carries this line and has to be fixed
 * there. Same rule as deleting a fixed line item.
 */
export async function deleteOnceOffBill(billId: number): Promise<BillState> {
  const user = await requirePermission(MANAGE);
  const bill = await loadOnceOffBill(billId);
  if (!bill) return { error: "That bill no longer exists." };

  const { basis } = await loadSplitBasis();
  const total = billTotal(bill, basis);

  await db.delete(onceOffBills).where(eq(onceOffBills.id, billId));

  await logEvent({
    action: "onceoff.deleted",
    summary: `Deleted the ${bill.status} once-off bill "${bill.description}" (${formatCurrency(total)}) for ${periodLabel(bill.period)}`,
    actor: user,
    entityType: "once_off_bill",
    entityId: billId,
    metadata: { period: bill.period, status: bill.status, total },
  });
  revalidateBillPaths();
  return {
    ok: true,
    note:
      bill.status === "submitted"
        ? "Deleted. It is off the Variable run — but any invoice already created in Xero still carries the line."
        : "Draft deleted.",
  };
}

/* ------------------------------------------------------------------ */
/* Submit                                                             */
/* ------------------------------------------------------------------ */

/**
 * Puts the bill on the Variable invoice run for its month, and tells people.
 *
 * Two audiences, both deliberate:
 *  - the person who CREATED it, always, even if somebody else submitted it;
 *  - whichever email group is chosen for `onceoff_bill_submitted` on the
 *    Notifications page. That is where "everyone tagged Finance Person" lives —
 *    as a live group rule, so tagging a new person is all it takes.
 *
 * The two lists dedupe by address, so the creator being in the finance group
 * still gets exactly one email.
 *
 * A failed send does NOT fail the submission. The bill is on the run either
 * way, and rolling that back because a mailbox bounced would be worse than a
 * logged warning.
 */
export async function submitOnceOffBill(billId: number): Promise<BillState> {
  const user = await requirePermission(MANAGE);
  const bill = await loadOnceOffBill(billId);
  if (!bill) return { error: "That bill no longer exists." };
  if (bill.status === "submitted") return { error: "This bill has already been submitted." };

  const { basis } = await loadSplitBasis();
  const lines = resolveBillLines(bill, basis);
  const total = billTotal(bill, basis);
  if (lines.length === 0 || total === 0) {
    return {
      error:
        "On today's numbers this bill works out to R0.00, so submitting it would add nothing. Check the split and the quantities.",
    };
  }

  await db
    .update(onceOffBills)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      submittedByName: user.name,
      updatedAt: new Date(),
    })
    .where(eq(onceOffBills.id, billId));

  await logEvent({
    action: "onceoff.submitted",
    summary: `Submitted the once-off bill "${bill.description}" (${formatCurrency(total)}) to the Variable run for ${periodLabel(bill.period)}`,
    actor: user,
    entityType: "once_off_bill",
    entityId: billId,
    metadata: { period: bill.period, total },
  });
  revalidateBillPaths();

  const mailNote = await notifySubmitted(bill.id, total, user.name);
  return {
    ok: true,
    billId,
    note: `Submitted to the ${periodLabel(bill.period)} Variable invoice run. ${mailNote}`,
  };
}

/**
 * The creator plus the chosen group, deduped. Returns a sentence for the UI so
 * "who did this actually reach?" is answered on screen and not only in the log.
 */
async function notifySubmitted(
  billId: number,
  total: number,
  submittedBy: string,
): Promise<string> {
  const bill = await loadOnceOffBill(billId);
  if (!bill) return "";

  // The live address wins; the snapshot taken at creation is the fallback for
  // a creator whose user row has since been removed.
  let creatorEmail = bill.createdByEmail;
  if (bill.createdByUserId) {
    const [live] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, bill.createdByUserId))
      .limit(1);
    if (live?.email) creatorEmail = live.email;
  }

  const to: { email: string; name: string }[] = [];
  if (creatorEmail?.includes("@")) {
    to.push({ email: creatorEmail, name: bill.createdByName ?? "" });
  }
  // `notificationRecipients` skips anyone already on the message, so the
  // creator being in the finance group costs them nothing.
  to.push(...(await notificationRecipients("onceoff_bill_submitted", to.map((r) => r.email))));

  if (to.length === 0) {
    await logEvent({
      action: "onceoff.notify_nobody",
      summary: `Once-off bill "${bill.description}" was submitted but nobody could be emailed`,
      actorType: "system",
      entityType: "once_off_bill",
      entityId: bill.id,
    });
    return "Nobody was emailed — the bill has no creator address and no notification group is set.";
  }

  const { basis } = await loadSplitBasis();
  const companyNames = new Map((await billableCompanies()).map((c) => [c.id, c.name]));
  const quantity = billQuantity(bill);

  const mail = onceOffBillSubmittedEmail({
    description: bill.description,
    periodLabel: periodLabel(bill.period),
    total: formatCurrency(total),
    breakdown: resolveBillLines(bill, basis).map(
      (l) =>
        [
          companyNames.get(l.companyId) ?? `Company ${l.companyId}`,
          isPercentShaped(bill.splitMode)
            ? `${formatCurrency(l.amount)} (${Math.round(l.share * 10) / 10}%)`
            : `${formatCurrency(l.amount)} (${l.share} × ${formatCurrency(bill.unitAmount)})`,
        ] as [string, string],
    ),
    splitLabel: fixedSplitModeLabel(bill.splitMode),
    quantity: quantity === null ? null : String(quantity),
    unitAmount: formatCurrency(bill.unitAmount),
    createdBy: bill.createdByName ?? "Unknown",
    submittedBy,
    notes: bill.notes,
    billsUrl: `${await appBaseUrl()}/once-off-bills?period=${bill.period}`,
  });

  const results = await Promise.all(
    to.map(async (r) => ({
      email: r.email,
      res: await sendMail({
        to: r.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    })),
  );

  const failed = results.filter((x) => !x.res.ok);
  const byProvider: Partial<Record<MailProvider, number>> = {};
  for (const { res } of results) {
    if (res.ok) byProvider[res.provider] = (byProvider[res.provider] ?? 0) + 1;
  }
  const via = describeProviders(byProvider);

  await logEvent({
    action: failed.length ? "onceoff.notify_partial" : "onceoff.notified",
    summary: failed.length
      ? `Once-off bill "${bill.description}": ${results.length - failed.length} of ${results.length} email(s) sent${via ? ` ${via}` : ""}, ${failed.length} failed`
      : `Once-off bill "${bill.description}": emailed ${results.length} recipient(s)${via ? ` ${via}` : ""}`,
    actorType: "system",
    entityType: "once_off_bill",
    entityId: bill.id,
    metadata: { recipients: to.map((r) => r.email), failed: failed.map((f) => f.email) },
  });

  const sent = results.length - failed.length;
  if (failed.length === 0) {
    return `Emailed ${sent} ${sent === 1 ? "person" : "people"}.`;
  }
  return `Emailed ${sent} of ${results.length} — ${failed.length} failed, see the Activity Log.`;
}
