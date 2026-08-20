"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { emailGroups, staff, tags } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import {
  NOTIFICATION_TYPES,
  saveNotificationChoices,
  type NotificationChoice,
  type NotificationKey,
} from "@/lib/notifications";
import { setOrganiserTagId } from "@/lib/organisers";

export type NotificationState = { error?: string; ok?: boolean };

export async function saveNotificationRecipients(
  _prev: NotificationState,
  formData: FormData,
): Promise<NotificationState> {
  const actor = await requirePermission("notifications.manage");

  const choices: Partial<Record<NotificationKey, NotificationChoice>> = {};
  const wantedGroups: number[] = [];
  const wantedPeople: number[] = [];

  /** "" means nobody; anything else has to be a positive integer id. */
  const readId = (field: string): number | null | "bad" => {
    const raw = String(formData.get(field) ?? "").trim();
    if (raw === "") return null;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : "bad";
  };

  for (const type of NOTIFICATION_TYPES) {
    const groupId = readId(type.key);
    if (groupId === "bad") return { error: `That isn't a valid group for "${type.label}".` };
    const personId = readId(`${type.key}:person`);
    if (personId === "bad") return { error: `That isn't a valid person for "${type.label}".` };

    choices[type.key] = { groupId, personId };
    if (groupId) wantedGroups.push(groupId);
    if (personId) wantedPeople.push(personId);
  }

  // Everything chosen has to still exist and still be reachable. Storing an id
  // for a deleted group or a person who has left would read as "somebody is
  // being told" on the page while nobody actually is.
  const known = new Map<number, string>();
  if (wantedGroups.length > 0) {
    const found = await db
      .select({ id: emailGroups.id, name: emailGroups.name })
      .from(emailGroups)
      .where(inArray(emailGroups.id, wantedGroups));
    for (const g of found) known.set(g.id, g.name);
    if (wantedGroups.some((id) => !known.has(id))) {
      return { error: "One of those email groups no longer exists — reload and try again." };
    }
  }

  const knownPeople = new Map<number, string>();
  if (wantedPeople.length > 0) {
    const found = await db
      .select({ id: staff.id, name: staff.name, active: staff.active })
      .from(staff)
      .where(inArray(staff.id, wantedPeople));
    for (const p of found) if (p.active) knownPeople.set(p.id, p.name);
    if (wantedPeople.some((id) => !knownPeople.has(id))) {
      return { error: "One of those people is no longer on the team — reload and try again." };
    }
  }

  await saveNotificationChoices(choices);

  const named = NOTIFICATION_TYPES.map((t) => {
    const c = choices[t.key];
    const parts = [
      c?.groupId ? known.get(c.groupId) : null,
      c?.personId ? knownPeople.get(c.personId) : null,
    ].filter(Boolean);
    return parts.length > 0 ? `${t.label} → ${parts.join(" + ")}` : null;
  })
    .filter(Boolean)
    .join("; ");

  await logEvent({
    action: "notifications.update",
    summary: named
      ? `Set who is emailed — ${named}`
      : "Cleared the recipients on every notification",
    actor,
    entityType: "app_setting",
  });

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
