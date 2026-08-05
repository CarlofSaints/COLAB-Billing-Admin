import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, staff, staffTags, tags } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";

/**
 * Who the organisers are.
 *
 * Carl's rule, in his words: "his role is not relevant, his Organiser Tag is."
 * So this is deliberately NOT a permission on a role — Tyrone is Finance, and
 * the other six Finance people are not organisers.
 *
 * ⚠️ THE TAG'S NAME IS NOT IN THIS FILE, AND MUST NOT BE. What makes somebody
 * an organiser is "carries the tag named in `organiser.tag_id`", chosen on the
 * Notifications page. Hard-coding "ORGANISER" would mean renaming the tag
 * silently removed everyone's authority — the same trap as hard-coding a person.
 */

const SETTING_KEY = "organiser.tag_id";

/** The tag that confers it, or null while nobody has chosen one. */
export async function organiserTagId(): Promise<number | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, SETTING_KEY))
    .limit(1);

  const id = Number(row?.value);
  // A blank, a stray value or a deleted tag all mean "nobody is an organiser",
  // which is a safe answer: it withholds authority rather than granting it.
  return row?.value && Number.isInteger(id) && id > 0 ? id : null;
}

export async function setOrganiserTagId(tagId: number | null): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: SETTING_KEY, value: tagId == null ? null : String(tagId) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: tagId == null ? null : String(tagId), updatedAt: new Date() },
    });
}

/**
 * Is this login an organiser?
 *
 * The tag lives on the TEAM MEMBER, not on the login, so this has to bridge the
 * two — and across this app that link is `staff.userId` first, falling back to
 * a case-insensitive email match. Getting that backwards is how a real person
 * is told they have no team record (see `getBookerScope`, same rule).
 *
 * Super Admin passes regardless, the way it bypasses every other check here —
 * otherwise the person who administers the place could untag himself and lose
 * the ability to put it back.
 */
export async function isOrganiser(user: SessionUser): Promise<boolean> {
  if (user.roleKey === "super_admin") return true;

  const tagId = await organiserTagId();
  if (!tagId) return false;

  const [row] = await db
    .select({ id: staff.id })
    .from(staff)
    .innerJoin(staffTags, eq(staffTags.staffId, staff.id))
    .where(
      and(
        eq(staffTags.tagId, tagId),
        eq(staff.active, true),
        or(eq(staff.userId, user.id), sql`lower(${staff.email}) = ${user.email.toLowerCase()}`),
      ),
    )
    .limit(1);

  return row != null;
}

/** Every organiser, for the settings page to show who that currently means. */
export async function organiserPeople(): Promise<{ name: string; email: string | null }[]> {
  const tagId = await organiserTagId();
  if (!tagId) return [];
  return db
    .select({ name: staff.name, email: staff.email })
    .from(staff)
    .innerJoin(staffTags, eq(staffTags.staffId, staff.id))
    .where(and(eq(staffTags.tagId, tagId), eq(staff.active, true)))
    .orderBy(staff.name);
}

/** The tags available to choose from. */
export async function allTags(): Promise<{ id: number; name: string }[]> {
  return db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(tags.name);
}
