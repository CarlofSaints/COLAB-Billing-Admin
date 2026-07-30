import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { companies, emailGroupMembers, emailGroups, staff, staffTags, tags } from "@/db/schema";
import { matchesRule, parseRule, type GroupRule, type RulePerson } from "@/lib/group-rules";

/**
 * The single answer to "who is in this email group?".
 *
 * There are two kinds of group — a hand-picked member list and a saved filter
 * (see `group-rules.ts`) — and six places that need the membership: scheduled
 * mail, the mail sender, the groups page, chat channels, and both group
 * actions. Every one of them goes through here.
 *
 * That matters more than it looks. If any call site kept reading
 * `email_group_members` directly, a rule group would appear to have no members
 * in that feature while working correctly everywhere else — a live group that
 * silently emails nobody is worse than no live groups at all. Same discipline
 * as `loadFixedAllocations` in tag-billing.ts.
 */

export type GroupMember = {
  staffId: number;
  name: string;
  email: string | null;
  companyId: number;
  companyName: string;
};

export type GroupInfo = {
  id: number;
  name: string;
  description: string | null;
  rule: GroupRule | null;
};

/** Every team member, in the shape the rule matcher needs. */
async function loadPeople(): Promise<(RulePerson & { id: number })[]> {
  const rows = await db
    .select({
      id: staff.id,
      name: staff.name,
      email: staff.email,
      gender: staff.gender,
      position: staff.position,
      companyId: staff.companyId,
      companyName: companies.name,
      includeInBilling: staff.includeInBilling,
      active: staff.active,
    })
    .from(staff)
    .innerJoin(companies, eq(companies.id, staff.companyId));

  const tagRows = await db
    .select({ staffId: staffTags.staffId, id: tags.id, name: tags.name })
    .from(staffTags)
    .innerJoin(tags, eq(tags.id, staffTags.tagId));

  const byStaff = new Map<number, { id: number; name: string }[]>();
  for (const t of tagRows) {
    const list = byStaff.get(t.staffId);
    if (list) list.push({ id: t.id, name: t.name });
    else byStaff.set(t.staffId, [{ id: t.id, name: t.name }]);
  }

  return rows.map((r) => ({ ...r, tags: byStaff.get(r.id) ?? [] }));
}

/**
 * Members of each of the given groups, keyed by group id.
 *
 * Static groups are filtered to active people here so both kinds behave the
 * same — a rule group never returns someone who has left, and neither should
 * a hand-picked one.
 */
export async function resolveGroupMembers(
  groupIds: number[],
): Promise<Map<number, GroupMember[]>> {
  const out = new Map<number, GroupMember[]>();
  if (groupIds.length === 0) return out;

  const groups = await db
    .select({ id: emailGroups.id, rule: emailGroups.rule })
    .from(emailGroups)
    .where(inArray(emailGroups.id, groupIds));

  const ruleGroups = groups.filter((g) => parseRule(g.rule) != null);
  const staticGroups = groups.filter((g) => parseRule(g.rule) == null);

  if (staticGroups.length > 0) {
    const rows = await db
      .select({
        groupId: emailGroupMembers.groupId,
        staffId: staff.id,
        name: staff.name,
        email: staff.email,
        companyId: staff.companyId,
        companyName: companies.name,
        active: staff.active,
      })
      .from(emailGroupMembers)
      .innerJoin(staff, eq(staff.id, emailGroupMembers.staffId))
      .innerJoin(companies, eq(companies.id, staff.companyId))
      .where(
        inArray(
          emailGroupMembers.groupId,
          staticGroups.map((g) => g.id),
        ),
      );

    for (const g of staticGroups) out.set(g.id, []);
    for (const r of rows) {
      if (!r.active) continue;
      out.get(r.groupId)?.push({
        staffId: r.staffId,
        name: r.name,
        email: r.email,
        companyId: r.companyId,
        companyName: r.companyName,
      });
    }
  }

  if (ruleGroups.length > 0) {
    // One pass over the team for all rule groups — the office is ~80 people, so
    // filtering in memory beats a bespoke query per group by a wide margin.
    const people = await loadPeople();
    for (const g of ruleGroups) {
      const rule = parseRule(g.rule)!;
      out.set(
        g.id,
        people
          .filter((p) => matchesRule(p, rule))
          .map((p) => ({
            staffId: p.id,
            name: p.name,
            email: p.email,
            companyId: p.companyId,
            companyName: p.companyName ?? "",
          })),
      );
    }
  }

  for (const id of groupIds) if (!out.has(id)) out.set(id, []);
  return out;
}

/** Convenience for a single group. */
export async function resolveGroupMembership(groupId: number): Promise<GroupMember[]> {
  return (await resolveGroupMembers([groupId])).get(groupId) ?? [];
}

/**
 * Deduplicated, sendable recipients across several groups — what every mail
 * path actually wants. People without a usable address are dropped here rather
 * than at each call site.
 */
export async function resolveGroupRecipients(groupIds: number[]): Promise<GroupMember[]> {
  const byGroup = await resolveGroupMembers(groupIds);
  const seen = new Set<string>();
  const out: GroupMember[] = [];
  for (const members of byGroup.values()) {
    for (const m of members) {
      const email = (m.email ?? "").trim();
      if (!email.includes("@")) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...m, email });
    }
  }
  return out;
}

/** Which groups a person falls into — static membership or a matching rule. */
export async function groupsForStaff(staffId: number): Promise<GroupInfo[]> {
  const groups = await db
    .select({
      id: emailGroups.id,
      name: emailGroups.name,
      description: emailGroups.description,
      rule: emailGroups.rule,
    })
    .from(emailGroups)
    .orderBy(emailGroups.name);

  const byGroup = await resolveGroupMembers(groups.map((g) => g.id));
  return groups
    .filter((g) => byGroup.get(g.id)?.some((m) => m.staffId === staffId))
    .map((g) => ({ id: g.id, name: g.name, description: g.description, rule: parseRule(g.rule) }));
}
