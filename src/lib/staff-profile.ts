/**
 * Where a team member's own answers and an admin's stand-in meet.
 *
 * Pure functions, no server imports — the same rule has to hold on the team
 * list, the birthday panel and the export, so it lives in one place.
 */

/**
 * Gender, standardised to UPPERCASE.
 *
 * The column arrived two ways: the original Excel import wrote MALE / FEMALE,
 * and the Add/Edit dropdown wrote Male / Female. That left the same person
 * type recorded two ways, which broke sorting, the distinct-value filters on
 * Team Members and Email Groups (one list, two entries for the same thing) —
 * and worst, the edit dropdown couldn't match "MALE" against its own "Male"
 * option, so opening an imported person showed "—" and saving blanked them.
 *
 * UPPERCASE is the standard because that's what 74 of the 77 rows already
 * were. Applied on every write, so the free-text box on My Profile can stay
 * free text — type "male", it's stored MALE — without letting the split back
 * in through the side door.
 */
export function normaliseGender(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toUpperCase();
  return v || null;
}

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
