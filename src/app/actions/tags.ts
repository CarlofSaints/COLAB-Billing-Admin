"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tags } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

export type TagState = { error?: string; ok?: boolean };

const HEX = /^#[0-9a-fA-F]{6}$/;

const tagSchema = z.object({
  name: z.string().trim().min(1, "Give the tag a name").max(40),
  color: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || HEX.test(v), "Pick a colour"),
});

function parse(formData: FormData) {
  return tagSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color") || undefined,
  });
}

export async function createTag(_prev: TagState, formData: FormData): Promise<TagState> {
  const actor = await requirePermission("tags.manage");
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const [row] = await db
      .insert(tags)
      .values({ name: parsed.data.name, color: parsed.data.color || null })
      .returning();
    await logEvent({
      action: "tag.create",
      summary: `Created tag "${row.name}"`,
      actor,
      entityType: "tag",
      entityId: row.id,
    });
  } catch {
    return { error: "A tag with that name already exists." };
  }

  revalidatePath("/tags");
  revalidatePath("/staff");
  return { ok: true };
}

export async function updateTag(_prev: TagState, formData: FormData): Promise<TagState> {
  const actor = await requirePermission("tags.manage");
  const id = Number(formData.get("id"));
  if (!id) return { error: "Missing tag id" };
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await db
      .update(tags)
      .set({ name: parsed.data.name, color: parsed.data.color || null })
      .where(eq(tags.id, id));
  } catch {
    return { error: "A tag with that name already exists." };
  }
  await logEvent({
    action: "tag.update",
    summary: `Updated tag "${parsed.data.name}"`,
    actor,
    entityType: "tag",
    entityId: id,
  });

  revalidatePath("/tags");
  revalidatePath("/staff");
  return { ok: true };
}

export async function deleteTag(id: number) {
  const actor = await requirePermission("tags.manage");
  await db.delete(tags).where(eq(tags.id, id));
  await logEvent({
    action: "tag.delete",
    summary: "Deleted a tag",
    actor,
    entityType: "tag",
    entityId: id,
  });
  revalidatePath("/tags");
  revalidatePath("/staff");
}
