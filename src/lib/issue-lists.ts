import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { issueCategories, issuePlaces } from "@/db/schema";

/**
 * The two managed lists behind the issue form.
 *
 * Plain server helpers rather than server actions: in a `"use server"` file
 * every export becomes a POST endpoint the browser can call, and these have no
 * business being reachable from outside.
 */

export type IssueListItem = {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
};

/** What the report forms offer — active entries only, in display order. */
export async function activeCategories(): Promise<IssueListItem[]> {
  return db
    .select({
      id: issueCategories.id,
      name: issueCategories.name,
      description: issueCategories.description,
      active: issueCategories.active,
    })
    .from(issueCategories)
    .where(eq(issueCategories.active, true))
    .orderBy(asc(issueCategories.sortOrder), asc(issueCategories.name));
}

export async function activePlaces(): Promise<IssueListItem[]> {
  return db
    .select({
      id: issuePlaces.id,
      name: issuePlaces.name,
      description: issuePlaces.description,
      active: issuePlaces.active,
    })
    .from(issuePlaces)
    .where(eq(issuePlaces.active, true))
    .orderBy(asc(issuePlaces.sortOrder), asc(issuePlaces.name));
}

/** Everything, including hidden entries — for the management screen. */
export async function allCategories(): Promise<IssueListItem[]> {
  return db
    .select({
      id: issueCategories.id,
      name: issueCategories.name,
      description: issueCategories.description,
      active: issueCategories.active,
    })
    .from(issueCategories)
    .orderBy(asc(issueCategories.sortOrder), asc(issueCategories.name));
}

export async function allPlaces(): Promise<IssueListItem[]> {
  return db
    .select({
      id: issuePlaces.id,
      name: issuePlaces.name,
      description: issuePlaces.description,
      active: issuePlaces.active,
    })
    .from(issuePlaces)
    .orderBy(asc(issuePlaces.sortOrder), asc(issuePlaces.name));
}

/**
 * The chosen type, if it's real and still on offer.
 *
 * Both forms send an id from a list they were handed, so a miss means the list
 * moved underneath them (or the id was invented) — a refusal either way, never
 * a silent default to some other type.
 */
export async function resolveCategory(id: number): Promise<{ id: number; name: string } | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await db
    .select({ id: issueCategories.id, name: issueCategories.name })
    .from(issueCategories)
    .where(and(eq(issueCategories.id, id), eq(issueCategories.active, true)))
    .limit(1);
  return row ?? null;
}

/** Place is optional, so an absent or unknown id simply means "not given". */
export async function resolvePlace(id: number): Promise<{ id: number; name: string } | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await db
    .select({ id: issuePlaces.id, name: issuePlaces.name })
    .from(issuePlaces)
    .where(and(eq(issuePlaces.id, id), eq(issuePlaces.active, true)))
    .limit(1);
  return row ?? null;
}
