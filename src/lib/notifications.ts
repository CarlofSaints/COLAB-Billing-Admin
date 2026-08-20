import "server-only";
import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, staff } from "@/db/schema";
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
 * Two shapes of event use this, and the difference is worth knowing:
 *
 *  - The vehicle events ADD to a built-in list (the booker, the driver). The
 *    group can only widen that; choosing nobody changes nothing.
 *  - "Somebody reports an office issue" has NO built-in list any more. The
 *    group IS the recipients. It used to be hard-coded to every director and
 *    admin, which meant the one person who actually fixes things couldn't be
 *    told without also mailing seven people who wouldn't — and that couldn't be
 *    changed without a deploy. `soleRecipients` marks that on the type so the
 *    UI can say "nobody will be told" rather than "nobody extra".
 *
 * Each event may also name ONE person alongside the group, for the "…and copy
 * Jenny" case that isn't worth making a group for. They are merged and deduped
 * by email at send time, so picking somebody who is already in the group costs
 * them nothing. Two or more extra people is a group — make one.
 */

export type NotificationKey =
  | "vehicle_booked"
  | "vehicle_returned"
  | "vehicle_overdue"
  | "vehicle_cancelled"
  | "issue_reported"
  | "signup_requested";

export type NotificationType = {
  key: NotificationKey;
  label: string;
  /** What the event is, and who already gets it without any of this. */
  description: string;
  /**
   * True when the group is the WHOLE recipient list rather than an addition to
   * a built-in one — so "Nobody else" means nobody at all, and the page has to
   * say so.
   */
  soleRecipients?: boolean;
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
    description:
      "Goes to whoever is picked here and nobody else — from the Issues page and from the QR-code stickers alike.",
    soleRecipients: true,
  },
  {
    key: "signup_requested",
    label: "Somebody asks to join the hub",
    description:
      "Goes to whoever is picked here and nobody else. Pick people who can actually approve it — the email links to Join Requests.",
    soleRecipients: true,
  },
];

/** `notify.vehicle_booked` — namespaced so app_settings stays readable. */
function settingKey(key: NotificationKey): string {
  return `notify.${key}`;
}

/**
 * `notify.vehicle_booked.person` — the one named person, alongside the group.
 *
 * A separate row rather than a second value packed into the first: the group
 * and the person are edited, cleared and read independently, and a "3|17" style
 * value is the kind of thing that half-parses later.
 */
function personSettingKey(key: NotificationKey): string {
  return `notify.${key}.person`;
}

/** A blank, a stray value or a deleted row all mean "nobody" — never a throw. */
function toId(raw: string | null | undefined): number | null {
  const id = Number(raw);
  return raw && Number.isInteger(id) && id > 0 ? id : null;
}

export type NotificationChoice = {
  /** The email group, re-resolved at send time. */
  groupId: number | null;
  /**
   * ONE named team member, told as well as the group.
   *
   * Deliberately a single person and not a second group: this is the "…and
   * also copy Jenny" case, and anything bigger belongs in a group where the
   * membership is visible and reusable. Stored as a `staff` id — the same
   * thing a group resolves to — so the two lists dedupe by email cleanly.
   */
  personId: number | null;
};

/**
 * The group and person chosen for each event.
 *
 * One query for all of them: the settings page needs the whole map, and the
 * send paths only ever want one, so a per-key query would be a round trip per
 * notification on a page that renders once.
 */
export async function notificationChoices(): Promise<Record<NotificationKey, NotificationChoice>> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(
      inArray(
        appSettings.key,
        NOTIFICATION_TYPES.flatMap((t) => [settingKey(t.key), personSettingKey(t.key)]),
      ),
    );

  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<NotificationKey, NotificationChoice>;
  for (const type of NOTIFICATION_TYPES) {
    out[type.key] = {
      groupId: toId(byKey.get(settingKey(type.key))),
      personId: toId(byKey.get(personSettingKey(type.key))),
    };
  }
  return out;
}

export type ExtraRecipient = { email: string; name: string };

/**
 * The chosen group PLUS the chosen person, minus anyone already on the message.
 * On an additive event that's the extra copies; on a `soleRecipients` event
 * it's the whole list.
 *
 * `alreadyEmailed` matters more than it looks: the organiser is usually also a
 * person who books vehicles, and getting the same message twice — once as the
 * driver and once as the organiser — is how people start ignoring it. The named
 * person is deduped against the group for the same reason: picking somebody who
 * is already in the group is a natural thing to do and must not double up.
 */
export async function notificationRecipients(
  key: NotificationKey,
  alreadyEmailed: string[] = [],
): Promise<ExtraRecipient[]> {
  const { groupId, personId } = (await notificationChoices())[key];
  if (!groupId && !personId) return [];

  const seen = new Set(alreadyEmailed.map((e) => e.trim().toLowerCase()));
  const out: ExtraRecipient[] = [];

  const add = (email: string | null, name: string) => {
    const addr = (email ?? "").trim();
    if (!addr.includes("@")) return;
    const dedupe = addr.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({ email: addr, name });
  };

  if (groupId) for (const m of await resolveGroupRecipients([groupId])) add(m.email, m.name);
  if (personId) {
    const person = await notificationPerson(personId);
    // Gone or deactivated since being chosen: skipped exactly like a group
    // member who has left, rather than failing the whole send.
    if (person) add(person.email, person.name);
  }

  return out;
}

export type NotificationPerson = { id: number; name: string; email: string | null };

/** The named person for one event, if they are still an active team member. */
export async function notificationPerson(staffId: number): Promise<NotificationPerson | null> {
  const [row] = await db
    .select({ id: staff.id, name: staff.name, email: staff.email })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.active, true)))
    .limit(1);
  return row ?? null;
}

/** Everyone who can be picked as the named person — active, with an address. */
export async function notificationPeopleOptions(): Promise<NotificationPerson[]> {
  return db
    .select({ id: staff.id, name: staff.name, email: staff.email })
    .from(staff)
    .where(and(eq(staff.active, true), isNotNull(staff.email), ne(staff.email, "")))
    .orderBy(asc(staff.name));
}

/** Writes the choices. A null clears the row rather than storing an empty string. */
export async function saveNotificationChoices(
  choices: Partial<Record<NotificationKey, NotificationChoice>>,
): Promise<void> {
  for (const [key, choice] of Object.entries(choices) as [NotificationKey, NotificationChoice][]) {
    for (const [settingName, id] of [
      [settingKey(key), choice.groupId],
      [personSettingKey(key), choice.personId],
    ] as [string, number | null][]) {
      await db
        .insert(appSettings)
        .values({ key: settingName, value: id == null ? null : String(id) })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: id == null ? null : String(id), updatedAt: new Date() },
        });
    }
  }
}
