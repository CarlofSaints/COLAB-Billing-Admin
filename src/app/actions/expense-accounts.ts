"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { expenseAccountMappings } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import {
  isAccountMethod,
  parsePercentages,
  percentagesValid,
  METHOD_BY_KEY,
  type AccountMethod,
  type PercentEntry,
} from "@/lib/expense-accounts";

export type ActionState = { error?: string; ok?: boolean; savedAt?: number };

/** One row as posted by the grid. `method: null` means "clear this mapping". */
type MappingInput = {
  xeroAccountId: string;
  accountCode: string | null;
  accountName: string;
  accountType: string | null;
  method: AccountMethod | null;
  companyId: number | null;
  fixedLineItemId: number | null;
  percentages: PercentEntry[] | null;
  sensitive: boolean;
  balanceMethod: AccountMethod | null;
  balanceCompanyId: number | null;
  balancePercentages: PercentEntry[] | null;
};

function parsePayload(raw: FormDataEntryValue | null): MappingInput[] | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const rows: MappingInput[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return null;
    const r = item as Record<string, unknown>;
    const xeroAccountId = typeof r.xeroAccountId === "string" ? r.xeroAccountId.trim() : "";
    const accountName = typeof r.accountName === "string" ? r.accountName.trim() : "";
    if (!xeroAccountId || !accountName) return null;

    const rawMethod = typeof r.method === "string" ? r.method : "";
    const method = isAccountMethod(rawMethod) ? rawMethod : null;
    const rawBalance = typeof r.balanceMethod === "string" ? r.balanceMethod : "";
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isInteger(n) && n > 0 ? n : null;
    };

    rows.push({
      xeroAccountId,
      accountCode: typeof r.accountCode === "string" && r.accountCode ? r.accountCode : null,
      accountName,
      accountType: typeof r.accountType === "string" && r.accountType ? r.accountType : null,
      method,
      // Only keep the extra reference the chosen method actually uses.
      companyId: method === "direct" ? num(r.companyId) : null,
      fixedLineItemId: method === "fixed" ? num(r.fixedLineItemId) : null,
      percentages: method === "percent" ? parsePercentages(r.percentages) : null,
      sensitive: r.sensitive === true,
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
 * Save the expense-account grid. Rows arrive as a JSON `payload` field —
 * the grid is fully dynamic, so a flat form-field-per-row encoding would be
 * far more fragile. Only the rows the user actually touched are sent.
 */
export async function saveAccountMappings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("controls.manage");

  const rows = parsePayload(formData.get("payload"));
  if (!rows) return { error: "Could not read the changes — reload the page and try again." };
  if (rows.length === 0) return { ok: true, savedAt: Date.now() };

  // "direct" is only meaningful once a company has been picked.
  const missingCompany = rows.find((r) => r.method === "direct" && !r.companyId);
  if (missingCompany) {
    return {
      error: `Choose which sub-company carries “${missingCompany.accountName}”.`,
    };
  }

  const badPercent = rows.find((r) => r.method === "percent" && !percentagesValid(r.percentages));
  if (badPercent) {
    return { error: `The percentages for “${badPercent.accountName}” must add up to 100%.` };
  }

  const toClear = rows.filter((r) => r.method === null).map((r) => r.xeroAccountId);
  const toUpsert = rows.filter((r) => r.method !== null);

  if (toClear.length > 0) {
    await db
      .delete(expenseAccountMappings)
      .where(inArray(expenseAccountMappings.xeroAccountId, toClear));
  }

  for (const r of toUpsert) {
    const values = {
      xeroAccountId: r.xeroAccountId,
      accountCode: r.accountCode,
      accountName: r.accountName,
      accountType: r.accountType,
      method: r.method!,
      companyId: r.companyId,
      fixedLineItemId: r.fixedLineItemId,
      percentages: r.percentages,
      sensitive: r.sensitive,
      balanceMethod: r.balanceMethod,
      balanceCompanyId: r.balanceCompanyId,
      balancePercentages: r.balancePercentages,
    };
    await db
      .insert(expenseAccountMappings)
      .values(values)
      .onConflictDoUpdate({
        target: expenseAccountMappings.xeroAccountId,
        set: { ...values, updatedAt: new Date() },
      });
  }

  const summary =
    toUpsert.length > 0 && toClear.length > 0
      ? `Mapped ${toUpsert.length} and cleared ${toClear.length} expense account(s)`
      : toUpsert.length > 0
        ? `Mapped ${toUpsert.length} expense account(s)`
        : `Cleared ${toClear.length} expense account mapping(s)`;

  await logEvent({
    action: "controls.account_mapping_update",
    summary,
    actor: user,
    entityType: "expense_account_mapping",
    metadata: {
      changed: rows.map((r) => ({
        code: r.accountCode,
        name: r.accountName,
        method: r.method ? METHOD_BY_KEY[r.method].short : "unmapped",
      })),
    },
  });

  revalidatePath("/expense-accounts");
  return { ok: true, savedAt: Date.now() };
}

/** Drop a single mapping (used by the row's clear button). */
export async function clearAccountMapping(xeroAccountId: string) {
  const user = await requirePermission("controls.manage");
  await db
    .delete(expenseAccountMappings)
    .where(eq(expenseAccountMappings.xeroAccountId, xeroAccountId));

  await logEvent({
    action: "controls.account_mapping_clear",
    summary: "Cleared an expense account mapping",
    actor: user,
    entityType: "expense_account_mapping",
    entityId: xeroAccountId,
  });

  revalidatePath("/expense-accounts");
}
