import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { resolveGroupRecipients } from "@/lib/group-members";

/**
 * "Who else should be told when this happens?"
 *
 * The point of this file is that no notification anywhere names a person, a
 * tag or a role. Each kind of event names an EMAIL GROUP, chosen in the UI, and
 * the group decides who is in it — a hand-picked list, or a live rule such as
 * "everyone tagged ORGANISER", re-evaluated at send time.
 *
 * That's one level further out than pointing the code at a tag, deliberately.
 * A tag name in code is still a hard-coded string: rename the tag and the
 * notification silently stops, and two different events can never go to two
 * different people without a deploy. Pointing at a group costs nothing extra —
 * `resolveGroupRecipients` is already the single answer to "who is in this
 * group?" for six other features — and it buys both of those.
 *
 * ⚠️ ADDITIVE, ALWAYS. These recipients are added to whoever the event already
 * emails (the booker, the driver, the admins), never a replacement for them.
 * A setting that could silently switch off an existing notification is a much
 * more dangerous thing to hand someone than one that can only add.
 */

export type NotificationKey =
  | "vehicle_booked"
  | "vehicle_returned"
  | "vehicle_overdue"
  | "vehicle_cancelled"
  | "issue_reported";

export type NotificationType = {
  key: NotificationKey;
  label: string;
  /** What the event is, and who already gets it without any of this. */
  description: string;
};

export const NOTIFICATION_TYPES: NotificationType[] = [
  {
    key: "vehicle_booked",
    label: "A vehicle is booked",
    description: "Already goes to whoever booked it and whoever is driving.",
  },
  {
    key: "vehicle_returned",
    label: "A vehicle is booked back in",
    description: "Already goes to the same two people, with the mileage and fuel.",
  },
  {
    key: "vehicle_overdue",
    label: "A vehicle is overdue",
    description: "Already goes to the same two people, once and then daily.",
  },
  {
    key: "vehicle_cancelled",
    label: "A vehicle booking is cancelled",
    description: "Already goes to the same two people.",
  },
  {
    key: "issue_reported",
    label: "Somebody reports an office issue",
    description: "Already goes to every director and admin.",
  },
];

/** `notify.vehicle_booked` — namespaced so app_settings stays readable. */
function settingKey(key: NotificationKey): string {
  return `notify.${key}`;
}

/**
 * The group chosen for each event, or null where nobody extra is told.
 *
 * One query for all of them: the settings page needs the whole map, and the
 * send paths only ever want one, so a per-key query would be five round trips
 * on a page that renders once.
 */
export async function notificationGroupIds(): Promise<Record<NotificationKey, number | null>> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(inArray(appSettings.key, NOTIFICATION_TYPES.map((t) => settingKey(t.key))));

  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<NotificationKey, number | null>;
  for (const type of NOTIFICATION_TYPES) {
    const raw = byKey.get(settingKey(type.key));
    const id = Number(raw);
    // A blank, a stray value or a deleted group all mean "nobody" — never a
    // reason for a send to throw.
    out[type.key] = raw && Number.isInteger(id) && id > 0 ? id : null;
  }
  return out;
}

export type ExtraRecipient = { email: string; name: string };

/**
 * The extra people to copy on one event, minus anyone already being emailed.
 *
 * `alreadyEmailed` matters more than it looks: the organiser is usually also a
 * person who books vehicles, and getting the same message twice — once as the
 * driver and once as the organiser — is how people start ignoring it.
 */
export async function extraRecipients(
  key: NotificationKey,
  alreadyEmailed: string[] = [],
): Promise<ExtraRecipient[]> {
  const groupId = (await notificationGroupIds())[key];
  if (!groupId) return [];

  const seen = new Set(alreadyEmailed.map((e) => e.trim().toLowerCase()));
  const members = await resolveGroupRecipients([groupId]);

  return members
    .filter((m) => m.email && !seen.has(m.email.toLowerCase()))
    .map((m) => ({ email: m.email as string, name: m.name }));
}

/** Writes the choices. A null clears the row rather than storing an empty string. */
export async function saveNotificationGroupIds(
  choices: Partial<Record<NotificationKey, number | null>>,
): Promise<void> {
  for (const [key, groupId] of Object.entries(choices) as [NotificationKey, number | null][]) {
    await db
      .insert(appSettings)
      .values({ key: settingKey(key), value: groupId == null ? null : String(groupId) })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: groupId == null ? null : String(groupId), updatedAt: new Date() },
      });
  }
}
