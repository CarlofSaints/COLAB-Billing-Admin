"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creditorLinks } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

export type LinkState = { error?: string; ok?: boolean };

// Balance methods offered for an overage (percent handled at account level).
const BALANCE = ["per_sqm", "headcount", "equal", "direct"] as const;
type Balance = (typeof BALANCE)[number];

/**
 * The Static items that pre-bill this creditor. A creditor's bill is routinely
 * covered by several — Yaxxa's by handsets, licences and fibre — and naming
 * one leaves the overage overstated by all the others, which then gets billed
 * a second time on the Variable run.
 */
function readItemIds(formData: FormData): number[] {
  const ids = formData
    .getAll("fixedLineItemIds")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

function readBalance(formData: FormData): { method: Balance | null; companyId: number | null } {
  const raw = String(formData.get("balanceMethod") ?? "");
  const method = (BALANCE as readonly string[]).includes(raw) ? (raw as Balance) : null;
  const companyId =
    method === "direct" ? Number(formData.get("balanceCompanyId")) || null : null;
  return { method, companyId };
}

export async function createCreditorLink(
  _prev: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const actor = await requirePermission("controls.manage");
  const xeroContactId = String(formData.get("xeroContactId") ?? "").trim();
  const xeroContactName = String(formData.get("xeroContactName") ?? "").trim();
  const fixedLineItemIds = readItemIds(formData);
  if (!xeroContactId || !xeroContactName) return { error: "Choose a creditor." };
  if (fixedLineItemIds.length === 0)
    return { error: "Choose at least one Static line item it is billed by." };

  const { method, companyId } = readBalance(formData);
  if (method === "direct" && !companyId) return { error: "Choose the company for a direct split." };

  try {
    const [row] = await db
      .insert(creditorLinks)
      .values({
        xeroContactId,
        xeroContactName,
        fixedLineItemIds,
        balanceMethod: method,
        balanceCompanyId: companyId,
      })
      .returning();
    await logEvent({
      action: "creditor_link.create",
      summary: `Linked creditor ${xeroContactName} to a Static line item`,
      actor,
      entityType: "creditor_link",
      entityId: row.id,
    });
  } catch {
    return { error: "That creditor is already linked." };
  }

  revalidatePath("/creditor-links");
  return { ok: true };
}

export async function updateCreditorLink(
  _prev: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const actor = await requirePermission("controls.manage");
  const id = Number(formData.get("id"));
  const fixedLineItemIds = readItemIds(formData);
  if (!id) return { error: "Missing link id" };
  if (fixedLineItemIds.length === 0)
    return { error: "Choose at least one Static line item it is billed by." };

  const { method, companyId } = readBalance(formData);
  if (method === "direct" && !companyId) return { error: "Choose the company for a direct split." };

  await db
    .update(creditorLinks)
    .set({
      // Cleared so the legacy scalar can never disagree with the array.
      fixedLineItemId: null,
      fixedLineItemIds,
      balanceMethod: method,
      balanceCompanyId: companyId,
      updatedAt: new Date(),
    })
    .where(eq(creditorLinks.id, id));
  await logEvent({
    action: "creditor_link.update",
    summary: `Updated a creditor link`,
    actor,
    entityType: "creditor_link",
    entityId: id,
  });

  revalidatePath("/creditor-links");
  return { ok: true };
}

export async function deleteCreditorLink(id: number) {
  const actor = await requirePermission("controls.manage");
  await db.delete(creditorLinks).where(eq(creditorLinks.id, id));
  await logEvent({
    action: "creditor_link.delete",
    summary: "Removed a creditor link",
    actor,
    entityType: "creditor_link",
    entityId: id,
  });
  revalidatePath("/creditor-links");
}
