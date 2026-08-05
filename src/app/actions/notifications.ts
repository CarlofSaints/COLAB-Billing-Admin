"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { emailGroups, tags } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import {
  NOTIFICATION_TYPES,
  saveNotificationGroupIds,
  type NotificationKey,
} from "@/lib/notifications";
import { setOrganiserTagId } from "@/lib/organisers";

export type NotificationState = { error?: string; ok?: boolean };

export async function saveNotificationRecipients(
  _prev: NotificationState,
  formData: FormData,
): Promise<NotificationState> {
  const actor = await requirePermission("notifications.manage");

  const choices: Partial<Record<NotificationKey, number | null>> = {};
  const wanted: number[] = [];

  for (const type of NOTIFICATION_TYPES) {
    const raw = String(formData.get(type.key) ?? "").trim();
    if (raw === "") {
      choices[type.key] = null;
      continue;
    }
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return { error: `That isn't a valid group for "${type.label}".` };
    }
    choices[type.key] = id;
    wanted.push(id);
  }

  // Every chosen group has to exist. Storing an id for a group that has since
  // been deleted would read as "somebody is being told" on the page while
  // nobody actually is.
  if (wanted.length > 0) {
    const found = await db
      .select({ id: emailGroups.id, name: emailGroups.name })
      .from(emailGroups)
      .where(inArray(emailGroups.id, wanted));
    const known = new Map(found.map((g) => [g.id, g.name]));
    const missing = wanted.filter((id) => !known.has(id));
    if (missing.length > 0) {
      return { error: "One of those email groups no longer exists — reload and try again." };
    }

    const named = NOTIFICATION_TYPES.filter((t) => choices[t.key] != null)
      .map((t) => `${t.label} → ${known.get(choices[t.key] as number)}`)
      .join("; ");
    await saveNotificationGroupIds(choices);
    await logEvent({
      action: "notifications.update",
      summary: `Set who else is emailed — ${named}`,
      actor,
      entityType: "app_setting",
    });
  } else {
    await saveNotificationGroupIds(choices);
    await logEvent({
      action: "notifications.update",
      summary: "Cleared the extra recipients on every notification",
      actor,
      entityType: "app_setting",
    });
  }

  revalidatePath("/notifications");
  return { ok: true };
}

/**
 * Which tag makes somebody an organiser.
 *
 * A separate action from the notification routing above because it isn't
 * routing — it grants the power to decline somebody else's vehicle booking, and
 * a page that saved both from one button would make that easy to do by accident.
 */
export async function saveOrganiserTag(
  _prev: NotificationState,
  formData: FormData,
): Promise<NotificationState> {
  const actor = await requirePermission("notifications.manage");

  const raw = String(formData.get("tagId") ?? "").trim();
  if (raw === "") {
    await setOrganiserTagId(null);
    await logEvent({
      action: "notifications.organiser_tag",
      summary: "Cleared the organiser tag — nobody can decline vehicle bookings now",
      actor,
      entityType: "app_setting",
    });
    revalidatePath("/notifications");
    revalidatePath("/vehicle-bookings");
    return { ok: true };
  }

  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { error: "That isn't a valid tag." };

  const [tag] = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.id, id))
    .limit(1);
  if (!tag) return { error: "That tag no longer exists — reload and try again." };

  await setOrganiserTagId(tag.id);
  await logEvent({
    action: "notifications.organiser_tag",
    summary: `Anyone tagged "${tag.name}" can now decline vehicle bookings`,
    actor,
    entityType: "app_setting",
  });

  revalidatePath("/notifications");
  revalidatePath("/vehicle-bookings");
  return { ok: true };
}
