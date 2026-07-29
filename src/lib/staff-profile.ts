/**
 * Where a team member's own answers and an admin's stand-in meet.
 *
 * Pure functions, no server imports — the same rule has to hold on the team
 * list, the birthday panel and the export, so it lives in one place.
 */

/**
 * The date of birth to actually use.
 *
 * The person's own entry always wins. An admin's only shows through where the
 * person hasn't given one — so an admin can fill a gap for the birthday list
 * without ever overriding what someone said about themselves, and the moment
 * they do fill in their profile, theirs takes over with no cleanup needed.
 */
export function effectiveDateOfBirth(row: {
  dateOfBirth?: string | null;
  dateOfBirthAdmin?: string | null;
}): string | null {
  return row.dateOfBirth || row.dateOfBirthAdmin || null;
}

/** Which of the two is in play — for showing "set by them" vs "set by an admin". */
export function dateOfBirthSource(row: {
  dateOfBirth?: string | null;
  dateOfBirthAdmin?: string | null;
}): "self" | "admin" | "none" {
  if (row.dateOfBirth) return "self";
  if (row.dateOfBirthAdmin) return "admin";
  return "none";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "14 July" — birthdays are shown without the year. */
export function birthdayLabel(iso: string | null): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]}`;
}
