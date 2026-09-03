import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, onceOffBillAllocations, onceOffBills } from "@/db/schema";
import {
  deriveFixedShares,
  fixedAllocationAmount,
  fixedItemTotal,
  isDerivedMode,
  isPercentShaped,
  type FixedSplitBasis,
  type FixedSplitMode,
} from "./billing-calc";
import { loadSplitBasis } from "./split-basis";
import { periodLabel } from "./periods";

/**
 * Once-off bills — a charge that happens in one month and no other.
 *
 * The office buys 40 chairs. It isn't a fixed line item (those bill every
 * month forever) and it isn't a Xero supplier line waiting to be split (the
 * cost may not be in Xero at all, or may need dividing differently to the
 * account it sits in). So it is typed in here, split the same way anything
 * else is split, and lands on ONE month's Variable invoice.
 *
 * 🔑 This file is the single answer to "what does a once-off bill bill?".
 * The page, the submit email and the invoice engine all read `resolveBillLines`
 * — if any of them worked it out for itself, the number on screen and the
 * number on the invoice could differ, and the first sign would be a client
 * query about an amount nobody could explain. Same discipline as
 * `loadFixedAllocations` in tag-billing.ts.
 *
 * Draft vs submitted matters and is one-way:
 *  - **Draft** touches nothing. Saving a draft is just saving your work.
 *  - **Submitted** puts the bill on the Variable preview for its period. From
 *    that moment somebody may push it to Xero, so it can no longer be edited —
 *    the way to change a submitted bill is to delete it and make a new one,
 *    which is a visible act rather than a quiet rewrite of a billed amount.
 */

export type OnceOffAllocation = { companyId: number; quantity: number };

export type OnceOffBill = {
  id: number;
  description: string;
  period: string;
  splitMode: FixedSplitMode;
  unitAmount: number;
  notes: string | null;
  status: "draft" | "submitted";
  createdByUserId: number | null;
  createdByName: string | null;
  createdByEmail: string | null;
  submittedAt: Date | null;
  submittedByName: string | null;
  copiedFromId: number | null;
  createdAt: Date;
  allocations: OnceOffAllocation[];
};

/** One company's share of one bill, priced. */
export type OnceOffLine = {
  companyId: number;
  /** Units in quantity mode, a percentage in every other mode. */
  share: number;
  amount: number;
};

/* ------------------------------------------------------------------ */
/* Reading                                                            */
/* ------------------------------------------------------------------ */

function toBill(
  row: typeof onceOffBills.$inferSelect,
  allocations: OnceOffAllocation[],
): OnceOffBill {
  return {
    id: row.id,
    description: row.description,
    period: row.period,
    splitMode: row.splitMode as FixedSplitMode,
    unitAmount: Number(row.unitAmount),
    notes: row.notes,
    status: row.status as "draft" | "submitted",
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    createdByEmail: row.createdByEmail,
    submittedAt: row.submittedAt,
    submittedByName: row.submittedByName,
    copiedFromId: row.copiedFromId,
    createdAt: row.createdAt,
    allocations,
  };
}

/**
 * Every once-off bill, newest first, with its allocations attached.
 *
 * Two queries rather than a join with one row per allocation: the page shows
 * the whole list and rebuilding the nesting from a flat join is more code than
 * it saves at this size.
 */
export async function loadOnceOffBills(filter?: {
  period?: string;
  status?: "draft" | "submitted";
}): Promise<OnceOffBill[]> {
  const where = [
    filter?.period ? eq(onceOffBills.period, filter.period) : undefined,
    filter?.status ? eq(onceOffBills.status, filter.status) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(onceOffBills)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(onceOffBills.period), desc(onceOffBills.id));
  if (rows.length === 0) return [];

  const allocs = await db.select().from(onceOffBillAllocations);
  const byBill = new Map<number, OnceOffAllocation[]>();
  for (const a of allocs) {
    const list = byBill.get(a.onceOffBillId);
    const entry = { companyId: a.companyId, quantity: Number(a.quantity) };
    if (list) list.push(entry);
    else byBill.set(a.onceOffBillId, [entry]);
  }

  return rows.map((r) => toBill(r, byBill.get(r.id) ?? []));
}

/** One bill with its allocations, or null. */
export async function loadOnceOffBill(id: number): Promise<OnceOffBill | null> {
  const [row] = await db.select().from(onceOffBills).where(eq(onceOffBills.id, id)).limit(1);
  if (!row) return null;
  const allocs = await db
    .select()
    .from(onceOffBillAllocations)
    .where(eq(onceOffBillAllocations.onceOffBillId, id));
  return toBill(
    row,
    allocs.map((a) => ({ companyId: a.companyId, quantity: Number(a.quantity) })),
  );
}

/* ------------------------------------------------------------------ */
/* Pricing                                                            */
/* ------------------------------------------------------------------ */

/**
 * What each company pays for one bill, on today's numbers.
 *
 * For the derived modes (per m², per head, equal, direct) the stored quantity
 * is 0 and the share is worked out here from the basis — so a bill split per
 * head re-splits itself if the headcount changes between saving and running.
 * That is the same rule fixed line items follow.
 */
export function resolveBillLines(bill: OnceOffBill, basis: FixedSplitBasis): OnceOffLine[] {
  const companyIds = bill.allocations.map((a) => a.companyId);
  if (companyIds.length === 0) return [];

  const spec = { splitMode: bill.splitMode, unitAmount: bill.unitAmount };

  if (isDerivedMode(bill.splitMode)) {
    const shares = deriveFixedShares(bill.splitMode, companyIds, basis);
    return companyIds
      .map((companyId) => {
        const share = shares[companyId] ?? 0;
        return { companyId, share, amount: fixedAllocationAmount(spec, share) };
      })
      .filter((l) => l.amount !== 0);
  }

  return bill.allocations
    .map((a) => ({
      companyId: a.companyId,
      share: a.quantity,
      amount: fixedAllocationAmount(spec, a.quantity),
    }))
    .filter((l) => l.amount !== 0);
}

/** What the whole bill comes to across every company on it. */
export function billTotal(bill: OnceOffBill, basis: FixedSplitBasis): number {
  return fixedItemTotal(
    { splitMode: bill.splitMode, unitAmount: bill.unitAmount },
    resolveBillLines(bill, basis).map((l) => l.share),
  );
}

/**
 * The quantity the bill covers in total.
 *
 * Only meaningful in "quantity" mode — 40 chairs is 40 whether iRam takes 12 or
 * 20 of them. In every other mode the allocations are percentages of one cost,
 * so there is no quantity to total and this returns null rather than 100.
 */
export function billQuantity(bill: OnceOffBill): number | null {
  if (isPercentShaped(bill.splitMode)) return null;
  return Math.round(bill.allocations.reduce((s, a) => s + a.quantity, 0) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* What the invoice run asks for                                      */
/* ------------------------------------------------------------------ */

export type OnceOffInvoiceLine = {
  companyId: number;
  billId: number;
  description: string;
  amount: number;
  detail: string[];
};

/**
 * Every SUBMITTED once-off bill for a period, priced per company, ready to be
 * pushed onto the Variable preview.
 *
 * Drafts are excluded here rather than at the call site so there is exactly
 * one place that decides what reaches an invoice. A draft that billed would be
 * the worst kind of bug in this app: money on a client's invoice that nobody
 * meant to send.
 */
export async function onceOffInvoiceLines(
  period: string,
  knownBasis?: FixedSplitBasis,
): Promise<OnceOffInvoiceLine[]> {
  const bills = await loadOnceOffBills({ period, status: "submitted" });
  if (bills.length === 0) return [];

  const basis = knownBasis ?? (await loadSplitBasis()).basis;
  const label = periodLabel(period);
  const out: OnceOffInvoiceLine[] = [];

  for (const bill of bills) {
    for (const line of resolveBillLines(bill, basis)) {
      out.push({
        companyId: line.companyId,
        billId: bill.id,
        description: `${bill.description} — ${label}`,
        amount: line.amount,
        detail: [
          isPercentShaped(bill.splitMode)
            ? `${Math.round(line.share * 10) / 10}% of R${bill.unitAmount.toFixed(2)}`
            : `${line.share} × R${bill.unitAmount.toFixed(2)}`,
          "Once-off bill",
        ],
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Helpers shared by the page and the actions                         */
/* ------------------------------------------------------------------ */

export type BillCompany = { id: number; name: string };

/** The sub-companies a bill can be split across — the same set billing uses. */
export async function billableCompanies(): Promise<BillCompany[]> {
  return db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(and(eq(companies.type, "sub"), eq(companies.active, true)))
    .orderBy(asc(companies.name));
}
