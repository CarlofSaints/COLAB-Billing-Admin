import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff, companies, tags, staffTags } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { brandFor } from "@/lib/brands";
import { HubWallpaper } from "@/components/hub-wallpaper";
import { DirectoryClient, type Person } from "./directory-client";

export const metadata = { title: "Meet Your Team — COLAB" };

/**
 * Meet Your Team — the social directory.
 *
 * Everything on it already exists: people fill in a bio, hobbies and a photo
 * on My Profile, and admins set their sub-company and tags on Team Members.
 * None of it was ever shown to the person sitting two desks away. This is the
 * read-only front of that data, and nothing more — the Team Members page stays
 * exactly as it is for the admin side (billing flags, cell numbers, inactive
 * people). There is deliberately no edit path from here.
 *
 * Two things are held back on purpose:
 *  - inactive people, who aren't part of the team to meet;
 *  - tags that haven't been ticked "Show in Hub", because the tag list is
 *    mostly internal admin and billing groupings.
 */
export default async function MeetTheTeamPage() {
  await requirePermission("hub.directory");

  const rows = await db
    .select({
      id: staff.id,
      name: staff.name,
      position: staff.position,
      bio: staff.bio,
      hobbies: staff.hobbies,
      photoUrl: staff.photoUrl,
      favouriteColour: staff.favouriteColour,
      companyName: companies.name,
    })
    .from(staff)
    .innerJoin(companies, eq(staff.companyId, companies.id))
    .where(eq(staff.active, true))
    .orderBy(asc(staff.name));

  // Only the tags marked "Show in Hub" — the gate is here, in the query, so a
  // tag that isn't meant to be public never reaches the browser at all.
  const tagLinks = await db
    .select({
      staffId: staffTags.staffId,
      id: tags.id,
      name: tags.name,
      color: tags.color,
    })
    .from(staffTags)
    .innerJoin(tags, eq(tags.id, staffTags.tagId))
    .where(eq(tags.showInHub, true))
    .orderBy(asc(tags.name));

  const tagsByStaff = new Map<number, { id: number; name: string; color: string | null }[]>();
  for (const l of tagLinks) {
    const list = tagsByStaff.get(l.staffId) ?? [];
    list.push({ id: l.id, name: l.name, color: l.color });
    tagsByStaff.set(l.staffId, list);
  }

  const people: Person[] = rows.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position ?? "",
    companyName: s.companyName,
    // Resolved on the server so the client component doesn't have to carry the
    // brand table around just to colour a label.
    companyColour: brandFor(s.companyName).color,
    bio: s.bio ?? "",
    hobbies: s.hobbies ?? [],
    hasPhoto: !!s.photoUrl,
    favouriteColour: s.favouriteColour ?? "#4f46e5",
    tags: tagsByStaff.get(s.id) ?? [],
  }));

  const companyNames = Array.from(new Set(people.map((p) => p.companyName))).sort();

  return (
    <div>
      <HubWallpaper />
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Meet Your Team</h1>
        <p className="mt-1 text-sm text-muted">
          Everyone at COLAB, in their own words. Want to change yours? It&apos;s all under My
          Account.
        </p>
      </div>
      <DirectoryClient people={people} companyNames={companyNames} />
    </div>
  );
}
