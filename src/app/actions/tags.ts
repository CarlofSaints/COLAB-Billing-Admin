"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tags } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { syncTagLineItem } from "@/lib/tag-billing";
import { formatCurrency } from "@/lib/utils";

export type TagState = { error?: string; ok?: boolean };

/**
 * A costed tag feeds the recurring invoice through its fixed line item, so a
 * tag edit has to refresh Controls and the dashboard too, not just the tag
 * screens.
 */
function revalidateTagPaths() {
  revalidatePath("/tags");
  revalidatePath("/staff");
  revalidatePath("/controls");
  revalidatePath("/invoices");
  // "Show in Hub" decides what the whole office sees on Meet Your Team.
  revalidatePath("/meet-the-team");
  revalidatePath("/");
}

const HEX = /^#[0-9a-fA-F]{6}$/;

const tagSchema = z.object({
  name: z.string().trim().min(1, "Give the tag a name").max(40),
  color: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || HEX.test(v), "Pick a colour"),
  // Blank = a plain label tag (Reception, Admin). A number makes the tag
  // billable: each tagged person costs this much a month.
  costPerPerson: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine(
      (v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 1_000_000),
      "Enter a cost like 850, or leave it blank for a label-only tag",
    ),
  // An unticked checkbox isn't submitted at all, so absence means "off".
  showInHub: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});

function parse(formData: FormData) {
  return tagSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color") || undefined,
    costPerPerson: String(formData.get("costPerPerson") ?? ""),
    showInHub: formData.get("showInHub") ?? undefined,
  });
}

export async function createTag(_prev: TagState, formData: FormData): Promise<TagState> {
  const actor = await requirePermission("tags.manage");
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, color, costPerPerson, showInHub } = parsed.data;
  try {
    const [row] = await db
      .insert(tags)
      .values({
        name,
        color: color || null,
        costPerPerson: costPerPerson === null ? null : costPerPerson.toFixed(2),
        showInHub,
      })
      .returning();
    await syncTagLineItem(row.id, row.name, costPerPerson);
    await logEvent({
      action: "tag.create",
      summary:
        costPerPerson === null
          ? `Created tag "${row.name}"`
          : `Created billable tag "${row.name}" at ${formatCurrency(costPerPerson)} per person`,
      actor,
      entityType: "tag",
      entityId: row.id,
    });
  } catch {
    return { error: "A tag with that name already exists." };
  }

  revalidateTagPaths();
  return { ok: true };
}

export async function updateTag(_prev: TagState, formData: FormData): Promise<TagState> {
  const actor = await requirePermission("tags.manage");
  const id = Number(formData.get("id"));
  if (!id) return { error: "Missing tag id" };
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { name, color, costPerPerson, showInHub } = parsed.data;
  const [before] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  if (!before) return { error: "That tag no longer exists." };
  const previousCost = before.costPerPerson === null ? null : Number(before.costPerPerson);

  try {
    await db
      .update(tags)
      .set({
        name,
        color: color || null,
        costPerPerson: costPerPerson === null ? null : costPerPerson.toFixed(2),
        showInHub,
      })
      .where(eq(tags.id, id));
  } catch {
    return { error: "A tag with that name already exists." };
  }
  await syncTagLineItem(id, name, costPerPerson);

  // Money changes are worth spelling out in the log — this one moves what
  // goes out on the recurring invoice.
  let summary = `Updated tag "${name}"`;
  if (previousCost !== costPerPerson) {
    if (costPerPerson === null) {
      summary = `Removed the cost from tag "${name}" — its recurring line item is now inactive`;
    } else if (previousCost === null) {
      summary = `Made tag "${name}" billable at ${formatCurrency(costPerPerson)} per person`;
    } else {
      summary = `Changed tag "${name}" from ${formatCurrency(previousCost)} to ${formatCurrency(costPerPerson)} per person`;
    }
  } else if (before.showInHub !== showInHub) {
    // Worth its own line: this is the one field that changes what all 77
    // people see on Meet Your Team.
    summary = showInHub
      ? `Tag "${name}" is now shown on Meet Your Team`
      : `Tag "${name}" is no longer shown on Meet Your Team`;
  }
  await logEvent({ action: "tag.update", summary, actor, entityType: "tag", entityId: id });

  revalidateTagPaths();
  return { ok: true };
}

export async function deleteTag(id: number) {
  const actor = await requirePermission("tags.manage");
  const [tag] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);

  // Stand the billing down before the tag goes. The FK is "set null", so
  // without this the item would survive the delete with no tag and no
  // allocations — billing nothing, but still linked from an expense account
  // and still looking live on Controls.
  await syncTagLineItem(id, tag?.name ?? "", null);

  await db.delete(tags).where(eq(tags.id, id));
  await logEvent({
    action: "tag.delete",
    summary: tag ? `Deleted tag "${tag.name}"` : "Deleted a tag",
    actor,
    entityType: "tag",
    entityId: id,
  });
  revalidateTagPaths();
}
