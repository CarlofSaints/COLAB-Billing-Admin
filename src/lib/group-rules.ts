/**
 * Live email groups — a saved filter rather than a saved list of people.
 *
 * A static group is a row per member: tag someone Reception tomorrow and they
 * are still outside the "all Reception" group until somebody remembers to add
 * them. A rule group stores the filter instead and answers "who is in this?"
 * at the moment it is asked, so the membership cannot go stale.
 *
 * Client-safe on purpose: the group form previews exactly who matches, using
 * this same function, so what is shown is what will be emailed.
 */

/**
 * The filter itself. Mirrors the team-list filters field for field so "filter
 * the list, save it as a group" is a straight hand-off — with gender added,
 * which the list only reaches through free-text search.
 *
 * Every field is a narrowing step; null/empty means "don't narrow on this".
 */
export type GroupRule = {
  /** A single sub-company, or null for everyone. */
  companyId: number | null;
  /**
   * Tag ids, ANDed — someone must carry all of them. Same choice the team
   * list makes: "Reception AND Admin" is the question people actually ask.
   */
  tagIds: number[];
  /** Only people carrying no tags at all. Mutually exclusive with tagIds. */
  untaggedOnly: boolean;
  /** Exact match on the gender recorded on the team member, or null for any. */
  gender: string | null;
  /** Narrow to people who are (or aren't) billed for. Null for either. */
  includeInBilling: boolean | null;
  /** Free text over name, email, company, position, gender and tag names. */
  search: string | null;
};

export const EMPTY_RULE: GroupRule = {
  companyId: null,
  tagIds: [],
  untaggedOnly: false,
  gender: null,
  includeInBilling: null,
  search: null,
};

/** The shape the matcher needs — both the client list and the server row fit. */
export type RulePerson = {
  name: string;
  email: string | null;
  gender: string | null;
  position: string | null;
  companyId: number;
  companyName: string | null;
  includeInBilling: boolean;
  active: boolean;
  tags: { id: number; name: string }[];
};

/**
 * Does this person fall in the group right now?
 *
 * Inactive people never match. Someone who has left shouldn't reappear in a
 * mailshot because a rule happened to describe them — and the static groups
 * already filter on `active` at send time, so this keeps the two consistent.
 */
export function matchesRule(person: RulePerson, rule: GroupRule): boolean {
  if (!person.active) return false;
  if (rule.companyId != null && person.companyId !== rule.companyId) return false;
  if (rule.untaggedOnly && person.tags.length > 0) return false;
  if (rule.tagIds.length > 0) {
    const mine = new Set(person.tags.map((t) => t.id));
    if (!rule.tagIds.every((id) => mine.has(id))) return false;
  }
  if (rule.gender && (person.gender ?? "").toLowerCase() !== rule.gender.toLowerCase()) {
    return false;
  }
  if (rule.includeInBilling != null && person.includeInBilling !== rule.includeInBilling) {
    return false;
  }
  const q = rule.search?.trim().toLowerCase();
  if (q) {
    const haystack = [
      person.name,
      person.email,
      person.companyName,
      person.position,
      person.gender,
      ...person.tags.map((t) => t.name),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

/** Coerces whatever is in the jsonb column into a rule, tolerating old shapes. */
export function parseRule(value: unknown): GroupRule | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return {
    companyId: typeof v.companyId === "number" ? v.companyId : null,
    tagIds: Array.isArray(v.tagIds) ? v.tagIds.filter((n): n is number => typeof n === "number") : [],
    untaggedOnly: v.untaggedOnly === true,
    gender: typeof v.gender === "string" && v.gender ? v.gender : null,
    includeInBilling: typeof v.includeInBilling === "boolean" ? v.includeInBilling : null,
    search: typeof v.search === "string" && v.search.trim() ? v.search.trim() : null,
  };
}

/** Plain-English summary, e.g. "Everyone tagged Reception at Atomic Marketing". */
export function describeRule(
  rule: GroupRule,
  lookup: { companyName?: (id: number) => string | undefined; tagName?: (id: number) => string | undefined } = {},
): string {
  const parts: string[] = [];

  if (rule.untaggedOnly) {
    parts.push("everyone with no tags");
  } else if (rule.tagIds.length > 0) {
    const names = rule.tagIds.map((id) => lookup.tagName?.(id) ?? `tag ${id}`);
    parts.push(`everyone tagged ${names.join(" and ")}`);
  } else {
    parts.push("everyone");
  }

  if (rule.gender) parts.push(`who is ${rule.gender}`);
  if (rule.companyId != null) {
    parts.push(`at ${lookup.companyName?.(rule.companyId) ?? "one sub-company"}`);
  }
  if (rule.includeInBilling === true) parts.push("who is billed for");
  if (rule.includeInBilling === false) parts.push("who is not billed for");
  if (rule.search) parts.push(`matching “${rule.search}”`);

  const sentence = parts.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
