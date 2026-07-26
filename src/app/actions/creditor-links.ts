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
  const fixedLineItemId = Number(formData.get("fixedLineItemId"));
  if (!xeroContactId || !xeroContactName) return { error: "Choose a creditor." };
  if (!fixedLineItemId) return { error: "Choose the recurring line item it's billed by." };

  const { method, companyId } = readBalance(formData);
  if (method === "direct" && !companyId) return { error: "Choose the company for a direct split." };

  try {
    const [row] = await db
      .insert(creditorLinks)
      .values({
        xeroContactId,
        xeroContactName,
        fixedLineItemId,
        balanceMethod: method,
        balanceCompanyId: companyId,
      })
      .returning();
    await logEvent({
      action: "creditor_link.create",
      summary: `Linked creditor ${xeroContactName} to a recurring line item`,
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
  const fixedLineItemId = Number(formData.get("fixedLineItemId"));
  if (!id) return { error: "Missing link id" };
  if (!fixedLineItemId) return { error: "Choose the recurring line item it's billed by." };

  const { method, companyId } = readBalance(formData);
  if (method === "direct" && !companyId) return { error: "Choose the company for a direct split." };

  await db
    .update(creditorLinks)
    .set({
      fixedLineItemId,
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
