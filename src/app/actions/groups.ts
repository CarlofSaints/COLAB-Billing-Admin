"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { emailGroups, emailGroupMembers } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import type { GroupRule } from "@/lib/group-rules";

export type ActionState = { error?: string; ok?: boolean };

const groupSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional(),
});

/**
 * Reads the membership rule off a form. Returns null for a hand-picked group,
 * which is what `email_groups.rule = null` means.
 *
 * `untaggedOnly` and `tagIds` contradict each other, so the tag list wins and
 * the flag is dropped — a rule that can never match anybody is a trap, not a
 * filter.
 */
function ruleFromFormData(formData: FormData): GroupRule | null {
  if (String(formData.get("membership") ?? "list") !== "rule") return null;

  const tagIds = formData
    .getAll("ruleTagId")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);

  const companyId = Number(formData.get("ruleCompanyId"));
  const billing = String(formData.get("ruleBilling") ?? "");
  const gender = String(formData.get("ruleGender") ?? "").trim();
  const search = String(formData.get("ruleSearch") ?? "").trim();

  return {
    companyId: Number.isInteger(companyId) && companyId > 0 ? companyId : null,
    tagIds,
    untaggedOnly: tagIds.length === 0 && formData.get("ruleUntagged") === "on",
    gender: gender || null,
    includeInBilling: billing === "yes" ? true : billing === "no" ? false : null,
    search: search || null,
  };
}

/** How a rule reads in the activity log, without needing the tag/company names. */
function ruleSummary(rule: GroupRule | null): string {
  if (!rule) return "a hand-picked member list";
  const bits: string[] = [];
  if (rule.tagIds.length) bits.push(`${rule.tagIds.length} tag(s)`);
  if (rule.untaggedOnly) bits.push("untagged only");
  if (rule.companyId) bits.push("one sub-company");
  if (rule.gender) bits.push(rule.gender);
  if (rule.includeInBilling != null) bits.push(rule.includeInBilling ? "billed" : "not billed");
  if (rule.search) bits.push(`“${rule.search}”`);
  return `a live rule (${bits.join(", ") || "everyone"})`;
}

export async function createGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("groups.manage");
  const parsed = groupSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const rule = ruleFromFormData(formData);
  const [row] = await db
    .insert(emailGroups)
    .values({ ...parsed.data, rule })
    .returning();
  await logEvent({
    action: "group.create",
    summary: `Created email group “${row.name}” — ${ruleSummary(rule)}`,
    actor: user,
    entityType: "email_group",
    entityId: row.id,
  });

  revalidatePath("/email-groups");
  return { ok: true };
}

export async function updateGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("groups.manage");
  const id = Number(formData.get("id"));
  if (!id) return { error: "Missing group id" };
  const parsed = groupSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Switching a group from a rule back to a hand-picked list deliberately
  // leaves `email_group_members` alone — the old picks are still there to
  // return to, and the resolver ignores them while a rule is set.
  const rule = ruleFromFormData(formData);
  await db
    .update(emailGroups)
    .set({ ...parsed.data, rule, updatedAt: new Date() })
    .where(eq(emailGroups.id, id));
  await logEvent({
    action: "group.update",
    summary: `Updated email group “${parsed.data.name}” — now ${ruleSummary(rule)}`,
    actor: user,
    entityType: "email_group",
    entityId: id,
  });

  revalidatePath("/email-groups");
  return { ok: true };
}

export async function deleteGroup(id: number) {
  const user = await requirePermission("groups.manage");
  await db.delete(emailGroups).where(eq(emailGroups.id, id));
  await logEvent({
    action: "group.delete",
    summary: "Deleted an email group",
    actor: user,
    entityType: "email_group",
    entityId: id,
  });
  revalidatePath("/email-groups");
}

/**
 * "Save this filter as a group", straight off the team list.
 *
 * Always creates a LIVE group: the point of arriving here from a filter is
 * that the filter is the definition. Someone who wants a frozen list can make
 * an ordinary group and tick people.
 */
export async function createGroupFromFilter(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("groups.manage");
  const parsed = groupSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const rule = ruleFromFormData(formData);
  if (!rule) return { error: "No filter was carried over — set one on the team list first." };

  const [row] = await db
    .insert(emailGroups)
    .values({ ...parsed.data, rule })
    .returning();

  await logEvent({
    action: "group.create_from_filter",
    summary: `Created live email group “${row.name}” from a team-list filter — ${ruleSummary(rule)}`,
    actor: user,
    entityType: "email_group",
    entityId: row.id,
  });

  revalidatePath("/email-groups");
  revalidatePath("/staff");
  return { ok: true };
}

/** Replace the full membership of a group with the checked staff ids. */
export async function saveGroupMembers(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("groups.manage");
  const groupId = Number(formData.get("groupId"));
  if (!groupId) return { error: "Missing group id" };

  const staffIds = formData
    .getAll("member")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);

  await db.delete(emailGroupMembers).where(eq(emailGroupMembers.groupId, groupId));
  if (staffIds.length > 0) {
    await db
      .insert(emailGroupMembers)
      .values(staffIds.map((staffId) => ({ groupId, staffId })))
      .onConflictDoNothing();
  }

  await logEvent({
    action: "group.members_update",
    summary: `Updated members of an email group (${staffIds.length} people)`,
    actor: user,
    entityType: "email_group",
    entityId: groupId,
    metadata: { count: staffIds.length },
  });

  revalidatePath("/email-groups");
  return { ok: true };
}
