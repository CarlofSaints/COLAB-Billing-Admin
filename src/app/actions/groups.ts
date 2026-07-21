"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { emailGroups, emailGroupMembers } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

export type ActionState = { error?: string; ok?: boolean };

const groupSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional(),
});

export async function createGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("groups.manage");
  const parsed = groupSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [row] = await db.insert(emailGroups).values(parsed.data).returning();
  await logEvent({
    action: "group.create",
    summary: `Created email group “${row.name}”`,
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

  await db
    .update(emailGroups)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(emailGroups.id, id));
  await logEvent({
    action: "group.update",
    summary: `Updated email group “${parsed.data.name}”`,
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
