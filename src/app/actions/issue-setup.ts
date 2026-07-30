"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { issueCategories, issuePlaces, issues } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

/**
 * Managing the two lists behind the issue form — the types of issue, and the
 * places one can happen.
 *
 * Both behave the same way, and both DEACTIVATE rather than delete once
 * anything references them. Hard-deleting a type would blank it on every
 * historical ticket, which is a silent rewrite of the record. An entry nobody
 * has used yet is safe to remove outright, so that's the one case that really
 * deletes.
 */

export type SetupState = { error?: string; ok?: boolean };

const MAX_NAME = 60;

function cleanName(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

/* ------------------------------------------------------------------ */
/* Issue types                                                        */
/* ------------------------------------------------------------------ */

export async function saveIssueCategory(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const user = await requirePermission("issues.manage");
  const id = Number(formData.get("id")) || null;
  const name = cleanName(formData.get("name"));
  const description = cleanName(formData.get("description")) || null;

  if (!name) return { error: "Give the issue type a name." };
  if (name.length > MAX_NAME) return { error: `Keep the name under ${MAX_NAME} characters.` };

  const [clash] = await db
    .select({ id: issueCategories.id })
    .from(issueCategories)
    .where(sql`lower(${issueCategories.name}) = ${name.toLowerCase()}`)
    .limit(1);
  if (clash && clash.id !== id) return { error: `“${name}” is already on the list.` };

  if (id) {
    const [before] = await db
      .select({ name: issueCategories.name })
      .from(issueCategories)
      .where(eq(issueCategories.id, id))
      .limit(1);

    await db.update(issueCategories).set({ name, description }).where(eq(issueCategories.id, id));

    // Tickets store the name as text so they survive a deletion — which means
    // a rename has to be carried across, or the grid shows the old wording
    // forever and filtering by the new name finds nothing.
    if (before && before.name !== name) {
      await db.update(issues).set({ category: name }).where(eq(issues.categoryId, id));
    }

    await logEvent({
      action: "issue_category.update",
      summary: `Renamed issue type “${before?.name ?? ""}” to “${name}”`,
      actor: user,
      entityType: "issue_category",
      entityId: id,
    });
  } else {
    const [max] = await db
      .select({ n: sql<number>`coalesce(max(${issueCategories.sortOrder}), 0)::int` })
      .from(issueCategories);
    const [row] = await db
      .insert(issueCategories)
      .values({ name, description, sortOrder: (max?.n ?? 0) + 10 })
      .returning();
    await logEvent({
      action: "issue_category.create",
      summary: `Added issue type “${name}”`,
      actor: user,
      entityType: "issue_category",
      entityId: row.id,
    });
  }

  revalidatePath("/issues");
  return { ok: true };
}

export async function setIssueCategoryActive(id: number, active: boolean) {
  const user = await requirePermission("issues.manage");
  const [row] = await db
    .update(issueCategories)
    .set({ active })
    .where(eq(issueCategories.id, id))
    .returning();
  await logEvent({
    action: "issue_category.active",
    summary: `${active ? "Re-enabled" : "Hid"} issue type “${row?.name ?? ""}”`,
    actor: user,
    entityType: "issue_category",
    entityId: id,
  });
  revalidatePath("/issues");
}

/**
 * Removes a type. Only really deletes if no ticket has ever used it —
 * otherwise it's switched off, so it disappears from the report form without
 * touching the history.
 */
export async function deleteIssueCategory(id: number): Promise<SetupState> {
  const user = await requirePermission("issues.manage");

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(issues)
    .where(eq(issues.categoryId, id));

  const [row] = await db
    .select({ name: issueCategories.name })
    .from(issueCategories)
    .where(eq(issueCategories.id, id))
    .limit(1);

  if (count > 0) {
    await db.update(issueCategories).set({ active: false }).where(eq(issueCategories.id, id));
    await logEvent({
      action: "issue_category.retire",
      summary: `Hid issue type “${row?.name ?? ""}” — ${count} ticket(s) still use it`,
      actor: user,
      entityType: "issue_category",
      entityId: id,
    });
    revalidatePath("/issues");
    return {
      ok: true,
      error: `“${row?.name}” is used by ${count} ticket${count === 1 ? "" : "s"}, so it's been hidden from the form instead of deleted. The old tickets keep their type.`,
    };
  }

  await db.delete(issueCategories).where(eq(issueCategories.id, id));
  await logEvent({
    action: "issue_category.delete",
    summary: `Deleted unused issue type “${row?.name ?? ""}”`,
    actor: user,
    entityType: "issue_category",
    entityId: id,
  });
  revalidatePath("/issues");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Places                                                             */
/* ------------------------------------------------------------------ */

export async function saveIssuePlace(_prev: SetupState, formData: FormData): Promise<SetupState> {
  const user = await requirePermission("issues.manage");
  const id = Number(formData.get("id")) || null;
  const name = cleanName(formData.get("name"));
  const description = cleanName(formData.get("description")) || null;

  if (!name) return { error: "Give the place a name." };
  if (name.length > MAX_NAME) return { error: `Keep the name under ${MAX_NAME} characters.` };

  const [clash] = await db
    .select({ id: issuePlaces.id })
    .from(issuePlaces)
    .where(sql`lower(${issuePlaces.name}) = ${name.toLowerCase()}`)
    .limit(1);
  if (clash && clash.id !== id) return { error: `“${name}” is already on the list.` };

  if (id) {
    const [before] = await db
      .select({ name: issuePlaces.name })
      .from(issuePlaces)
      .where(eq(issuePlaces.id, id))
      .limit(1);

    await db.update(issuePlaces).set({ name, description }).where(eq(issuePlaces.id, id));
    if (before && before.name !== name) {
      await db.update(issues).set({ place: name }).where(eq(issues.placeId, id));
    }

    await logEvent({
      action: "issue_place.update",
      summary: `Renamed place “${before?.name ?? ""}” to “${name}”`,
      actor: user,
      entityType: "issue_place",
      entityId: id,
    });
  } else {
    const [max] = await db
      .select({ n: sql<number>`coalesce(max(${issuePlaces.sortOrder}), 0)::int` })
      .from(issuePlaces);
    const [row] = await db
      .insert(issuePlaces)
      .values({ name, description, sortOrder: (max?.n ?? 0) + 10 })
      .returning();
    await logEvent({
      action: "issue_place.create",
      summary: `Added place “${name}”`,
      actor: user,
      entityType: "issue_place",
      entityId: row.id,
    });
  }

  revalidatePath("/issues");
  return { ok: true };
}

export async function setIssuePlaceActive(id: number, active: boolean) {
  const user = await requirePermission("issues.manage");
  const [row] = await db
    .update(issuePlaces)
    .set({ active })
    .where(eq(issuePlaces.id, id))
    .returning();
  await logEvent({
    action: "issue_place.active",
    summary: `${active ? "Re-enabled" : "Hid"} place “${row?.name ?? ""}”`,
    actor: user,
    entityType: "issue_place",
    entityId: id,
  });
  revalidatePath("/issues");
}

export async function deleteIssuePlace(id: number): Promise<SetupState> {
  const user = await requirePermission("issues.manage");

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(issues)
    .where(eq(issues.placeId, id));

  const [row] = await db
    .select({ name: issuePlaces.name })
    .from(issuePlaces)
    .where(eq(issuePlaces.id, id))
    .limit(1);

  if (count > 0) {
    await db.update(issuePlaces).set({ active: false }).where(eq(issuePlaces.id, id));
    await logEvent({
      action: "issue_place.retire",
      summary: `Hid place “${row?.name ?? ""}” — ${count} ticket(s) still use it`,
      actor: user,
      entityType: "issue_place",
      entityId: id,
    });
    revalidatePath("/issues");
    return {
      ok: true,
      error: `“${row?.name}” is used by ${count} ticket${count === 1 ? "" : "s"}, so it's been hidden from the form instead of deleted. The old tickets keep their place.`,
    };
  }

  await db.delete(issuePlaces).where(eq(issuePlaces.id, id));
  await logEvent({
    action: "issue_place.delete",
    summary: `Deleted unused place “${row?.name ?? ""}”`,
    actor: user,
    entityType: "issue_place",
    entityId: id,
  });
  revalidatePath("/issues");
  return { ok: true };
}
