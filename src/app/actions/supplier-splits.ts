"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { supplierSplits } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { isPeriod } from "@/lib/periods";
import {
  isAccountMethod,
  parsePercentages,
  percentagesValid,
  type AccountMethod,
  type PercentEntry,
} from "@/lib/expense-accounts";

export type ActionState = { error?: string; ok?: boolean; savedAt?: number };

type SplitInput = {
  accountCode: string;
  accountName: string | null;
  xeroContactId: string;
  supplierName: string;
  amount: number | null;
  method: AccountMethod | null;
  companyId: number | null;
  fixedLineItemId: number | null;
  percentages: PercentEntry[] | null;
  balanceMethod: AccountMethod | null;
  balanceCompanyId: number | null;
  balancePercentages: PercentEntry[] | null;
};

function parsePayload(raw: FormDataEntryValue | null): SplitInput[] | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const rows: SplitInput[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    const accountCode = typeof r.accountCode === "string" ? r.accountCode.trim() : "";
    const xeroContactId = typeof r.xeroContactId === "string" ? r.xeroContactId.trim() : "";
    const supplierName = typeof r.supplierName === "string" ? r.supplierName.trim() : "";
    if (!accountCode || !xeroContactId || !supplierName) return null;

    const rawMethod = typeof r.method === "string" ? r.method : "";
    const method = isAccountMethod(rawMethod) ? rawMethod : null;
    const rawBalance = typeof r.balanceMethod === "string" ? r.balanceMethod : "";
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isInteger(n) && n > 0 ? n : null;
    };
    const amount = Number(r.amount);

    rows.push({
      accountCode,
      accountName: typeof r.accountName === "string" && r.accountName ? r.accountName : null,
      xeroContactId,
      supplierName,
      amount: Number.isFinite(amount) ? amount : null,
      method,
      companyId: method === "direct" ? num(r.companyId) : null,
      fixedLineItemId: method === "fixed" ? num(r.fixedLineItemId) : null,
      percentages: method === "percent" ? parsePercentages(r.percentages) : null,
      balanceMethod: method === "fixed" && isAccountMethod(rawBalance) ? rawBalance : null,
      balanceCompanyId:
        method === "fixed" && rawBalance === "direct" ? num(r.balanceCompanyId) : null,
      balancePercentages:
        method === "fixed" && rawBalance === "percent"
          ? parsePercentages(r.balancePercentages)
          : null,
    });
  }
  return rows;
}

/**
 * Saves the split decisions for one billing month. Clearing a row deletes that
 * month's decision, which drops it back to inheriting the previous month (or
 * the account default) rather than leaving it unsplit.
 */
export async function saveSupplierSplits(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("controls.manage");

  const period = String(formData.get("period") ?? "");
  if (!isPeriod(period)) return { error: "That billing month isn't valid." };

  const rows = parsePayload(formData.get("payload"));
  if (!rows) return { error: "Could not read the changes — reload the page and try again." };
  if (rows.length === 0) return { ok: true, savedAt: Date.now() };

  const missingCompany = rows.find((r) => r.method === "direct" && !r.companyId);
  if (missingCompany) {
    return { error: `Choose which sub-company carries “${missingCompany.supplierName}”.` };
  }

  const badPercent = rows.find((r) => r.method === "percent" && !percentagesValid(r.percentages));
  if (badPercent) {
    return { error: `The percentages for “${badPercent.supplierName}” must add up to 100%.` };
  }

  const badBalanceCompany = rows.find(
    (r) => r.balanceMethod === "direct" && !r.balanceCompanyId,
  );
  if (badBalanceCompany) {
    return {
      error: `Choose which sub-company carries the balance on “${badBalanceCompany.supplierName}”.`,
    };
  }

  const badBalancePercent = rows.find(
    (r) => r.balanceMethod === "percent" && !percentagesValid(r.balancePercentages),
  );
  if (badBalancePercent) {
    return {
      error: `The balance percentages for “${badBalancePercent.supplierName}” must add up to 100%.`,
    };
  }

  const toClear = rows.filter((r) => r.method === null);
  const toUpsert = rows.filter((r) => r.method !== null);

  for (const r of toClear) {
    await db
      .delete(supplierSplits)
      .where(
        and(
          eq(supplierSplits.period, period),
          eq(supplierSplits.xeroContactId, r.xeroContactId),
          eq(supplierSplits.accountCode, r.accountCode),
        ),
      );
  }

  for (const r of toUpsert) {
    const values = {
      period,
      xeroContactId: r.xeroContactId,
      supplierName: r.supplierName,
      accountCode: r.accountCode,
      accountName: r.accountName,
      method: r.method!,
      companyId: r.companyId,
      fixedLineItemId: r.fixedLineItemId,
      percentages: r.percentages,
      balanceMethod: r.balanceMethod,
      balanceCompanyId: r.balanceCompanyId,
      balancePercentages: r.balancePercentages,
      amount: r.amount != null ? r.amount.toFixed(2) : null,
    };
    await db
      .insert(supplierSplits)
      .values(values)
      .onConflictDoUpdate({
        target: [supplierSplits.period, supplierSplits.xeroContactId, supplierSplits.accountCode],
        set: { ...values, updatedAt: new Date() },
      });
  }

  await logEvent({
    action: "controls.supplier_split_update",
    summary: `Updated ${rows.length} supplier split(s) for ${period}`,
    actor: user,
    entityType: "supplier_split",
    entityId: period,
    metadata: {
      set: toUpsert.length,
      cleared: toClear.length,
      suppliers: rows.map((r) => `${r.accountCode}:${r.supplierName}`),
    },
  });

  revalidatePath("/supplier-splits");
  return { ok: true, savedAt: Date.now() };
}

/**
 * Copies every inherited decision into this month as an explicit row, so the
 * month is pinned and later edits to earlier months can't change it.
 */
export async function pinInheritedSplits(
  period: string,
  rows: {
    accountCode: string;
    accountName: string | null;
    xeroContactId: string;
    supplierName: string;
    amount: number | null;
    method: string;
    companyId: number | null;
    fixedLineItemId: number | null;
    percentages: PercentEntry[] | null;
    balanceMethod: string | null;
    balanceCompanyId: number | null;
    balancePercentages: PercentEntry[] | null;
  }[],
): Promise<{ error?: string; pinned?: number }> {
  const user = await requirePermission("controls.manage");
  if (!isPeriod(period)) return { error: "That billing month isn't valid." };

  const valid = rows.filter((r) => isAccountMethod(r.method));
  if (valid.length === 0) return { pinned: 0 };

  const existing = await db
    .select({ contactId: supplierSplits.xeroContactId, accountCode: supplierSplits.accountCode })
    .from(supplierSplits)
    .where(eq(supplierSplits.period, period));
  const have = new Set(existing.map((e) => `${e.accountCode}|${e.contactId}`));

  const fresh = valid.filter((r) => !have.has(`${r.accountCode}|${r.xeroContactId}`));
  if (fresh.length === 0) return { pinned: 0 };

  await db.insert(supplierSplits).values(
    fresh.map((r) => ({
      period,
      xeroContactId: r.xeroContactId,
      supplierName: r.supplierName,
      accountCode: r.accountCode,
      accountName: r.accountName,
      method: r.method as AccountMethod,
      companyId: r.method === "direct" ? r.companyId : null,
      fixedLineItemId: r.method === "fixed" ? r.fixedLineItemId : null,
      percentages: r.method === "percent" ? r.percentages : null,
      balanceMethod:
        r.method === "fixed" && r.balanceMethod && isAccountMethod(r.balanceMethod)
          ? (r.balanceMethod as AccountMethod)
          : null,
      balanceCompanyId: r.balanceMethod === "direct" ? r.balanceCompanyId : null,
      balancePercentages: r.balanceMethod === "percent" ? r.balancePercentages : null,
      amount: r.amount != null ? r.amount.toFixed(2) : null,
    })),
  );

  await logEvent({
    action: "controls.supplier_split_pin",
    summary: `Pinned ${fresh.length} carried-forward split(s) for ${period}`,
    actor: user,
    entityType: "supplier_split",
    entityId: period,
  });

  revalidatePath("/supplier-splits");
  return { pinned: fresh.length };
}

/** Wipes every decision for a month, so it starts fresh from inheritance. */
export async function clearPeriodSplits(period: string) {
  const user = await requirePermission("controls.manage");
  if (!isPeriod(period)) return;
  await db.delete(supplierSplits).where(eq(supplierSplits.period, period));
  await logEvent({
    action: "controls.supplier_split_clear",
    summary: `Cleared all supplier splits set for ${period}`,
    actor: user,
    entityType: "supplier_split",
    entityId: period,
  });
  revalidatePath("/supplier-splits");
}

/** Used by the billing engine later: the resolved split set for a month. */
export async function splitsForPeriod(period: string) {
  await requirePermission("controls.view");
  return db.select().from(supplierSplits).where(inArray(supplierSplits.period, [period]));
}
