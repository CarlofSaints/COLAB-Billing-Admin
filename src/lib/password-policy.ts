/**
 * What counts as an acceptable password.
 *
 * Pure functions, no server imports — the same rule has to hold on the change
 * form and in the action that saves it, so it lives in one place.
 *
 * Length is the requirement that actually does the work, so the floor is 12
 * rather than the old 8, and there is no upper limit or character-class
 * gauntlet: forcing a symbol mostly produces "Password1!" and a sticky note.
 * What IS blocked is the small set of things people genuinely pick here —
 * their own name, their email, the company, and the usual suspects.
 */

export const MIN_PASSWORD_LENGTH = 12;

const COMMON = [
  "password", "passw0rd", "letmein", "welcome", "qwerty", "abc123", "111111",
  "123456", "12345678", "123456789", "1234567890", "iloveyou", "admin",
  "monkey", "dragon", "football", "sunshine", "princess", "master", "login",
  "changeme", "secret", "colab", "colab2", "hub",
];

/** Personal details a password must not simply repeat. */
export type PasswordContext = { name?: string | null; email?: string | null };

/**
 * Returns a problem to show the person, or null if the password is fine.
 * Phrased as instructions rather than scolding — this is shown to someone
 * halfway through setting a password, not to an attacker.
 */
export function passwordProblem(password: string, ctx: PasswordContext = {}): string | null {
  const pw = password.trim();

  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you'll remember beats a short jumble you won't.`;
  }
  if (pw.length > 200) return "That password is too long.";

  const lower = pw.toLowerCase();

  if (COMMON.some((c) => lower === c || lower.replace(/[^a-z0-9]/g, "") === c)) {
    return "That's one of the most-guessed passwords there is. Pick something else.";
  }

  // A single repeated character or a straight run, at any length.
  if (/^(.)\1+$/.test(pw)) return "That's the same character over and over. Pick something else.";
  if ("abcdefghijklmnopqrstuvwxyz".includes(lower) || "01234567890".includes(lower)) {
    return "That's just a run of sequential characters. Pick something else.";
  }

  const email = (ctx.email ?? "").toLowerCase().trim();
  const localPart = email.split("@")[0] ?? "";
  if (email && lower.includes(email)) return "Your password can't contain your email address.";
  if (localPart.length >= 4 && lower.includes(localPart)) {
    return "Your password can't be built out of your email address.";
  }

  // Any name part of 4+ characters — "carl" out of "Carl Dos Santos".
  const nameParts = (ctx.name ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length >= 4);
  if (nameParts.some((p) => lower.includes(p))) return "Your password can't contain your name.";

  return null;
}
