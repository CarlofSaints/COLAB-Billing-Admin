import "server-only";
/**
 * Nudges for people who haven't finished setting themselves up.
 *
 * Two separate problems, two separate emails:
 *
 *   never signed in  — the account exists and has never been used. They need
 *                      to get in before anything else matters.
 *   profile gaps     — they're in, but the directory entry is half empty.
 *
 * ⚠️ THE SIGN-IN NUDGE CANNOT CONTAIN THEIR PASSWORD. Passwords are stored as
 * a one-way hash, so "remind them of their credentials" is not a thing the
 * system can do — the only options are to mint a NEW password (which kills the
 * one they may already have written down) or to point them at the reset flow.
 * It points them at the reset flow. Their existing password keeps working.
 *
 * ⚠️ TAGS ARE NOT IN THE PERSON-FACING EMAIL, deliberately. `updateMyProfile`
 * cannot write tags — they're applied by an admin and some of them cost money
 * (Parking, VOIP). Asking somebody to "add your tags" would be asking for
 * something they have no button for. Untagged people are surfaced on the
 * review page instead, as a job for the office.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, staff, staffTags, users } from "@/db/schema";
import {
  appBaseUrl,
  mailConfigured,
  profileNudgeEmail,
  sendMail,
  signInNudgeEmail,
} from "@/lib/mailer";

/** Turns the weekly automatic run on. Off until somebody deliberately says so. */
export const NUDGE_AUTO_KEY = "profile_nudges_auto";

/**
 * How long to leave someone alone after nudging them. A fortnight, not a week:
 * the daily cron would otherwise re-send to the same people every seven days
 * for as long as they ignored it, which is how a reminder becomes spam.
 */
export const NUDGE_COOLDOWN_DAYS = 14;
const COOLDOWN_MS = NUDGE_COOLDOWN_DAYS * 24 * 3_600_000;

/**
 * What a finished profile has in it — only fields the person can actually set
 * themselves on My Profile. Anything an admin owns has no business in a list
 * headed "here's what's missing from YOUR profile".
 */
export const PROFILE_FIELDS: {
  key: string;
  label: string;
  has: (row: ProfileRow) => boolean;
}[] = [
  { key: "photo", label: "Profile picture", has: (r) => Boolean(r.photoUrl) },
  { key: "cell", label: "Cell number", has: (r) => Boolean(r.cellNumber?.trim()) },
  { key: "position", label: "Job title", has: (r) => Boolean(r.position?.trim()) },
  { key: "birthday", label: "Date of birth", has: (r) => Boolean(r.dateOfBirth) },
  { key: "bio", label: "A line about what you do", has: (r) => Boolean(r.bio?.trim()) },
  { key: "hobbies", label: "Hobbies", has: (r) => (r.hobbies?.length ?? 0) > 0 },
];

export type ProfileRow = {
  photoUrl: string | null;
  cellNumber: string | null;
  position: string | null;
  dateOfBirth: string | null;
  bio: string | null;
  hobbies: string[] | null;
};

/** The labels of everything still blank, in the order the profile page asks. */
export function missingProfileFields(row: ProfileRow): string[] {
  return PROFILE_FIELDS.filter((f) => !f.has(row)).map((f) => f.label);
}

export type NudgeTarget = {
  userId: number;
  staffId: number | null;
  name: string;
  email: string;
  companyName: string | null;
  /** Empty for the never-signed-in bucket — nothing to list until they're in. */
  missing: string[];
  tagCount: number;
  lastNudgeAt: Date | null;
  /** False when the cooldown hasn't run out; the page still shows them, greyed. */
  dueForNudge: boolean;
};

export type NudgeCandidates = {
  neverSignedIn: NudgeTarget[];
  incompleteProfile: NudgeTarget[];
  /** Nothing to email about — a job for whoever applies tags. */
  untagged: { staffId: number; name: string; companyName: string | null }[];
};

function due(last: Date | null, now: number): boolean {
  return !last || now - last.getTime() >= COOLDOWN_MS;
}

/**
 * Everyone worth nudging right now.
 *
 * Joins users → staff on the FK first and falls back to matching email,
 * because the link is only written the first time somebody saves a profile —
 * and the people this whole feature is about are exactly the ones who never
 * have.
 */
export async function loadNudgeCandidates(): Promise<NudgeCandidates> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      lastLoginAt: users.lastLoginAt,
      lastLoginNudgeAt: users.lastLoginNudgeAt,
      staffId: staff.id,
      staffName: staff.name,
      companyName: sql<string | null>`(select name from companies where id = ${staff.companyId})`,
      photoUrl: staff.photoUrl,
      cellNumber: staff.cellNumber,
      position: staff.position,
      dateOfBirth: staff.dateOfBirth,
      bio: staff.bio,
      hobbies: staff.hobbies,
      lastProfileNudgeAt: staff.lastProfileNudgeAt,
      tagCount: sql<number>`(
        select count(*)::int from staff_tags where staff_tags.staff_id = ${staff.id}
      )`,
    })
    .from(users)
    .leftJoin(
      staff,
      sql`${staff.userId} = ${users.id} or lower(${staff.email}) = lower(${users.email})`,
    )
    .where(eq(users.active, true));

  const now = Date.now();
  const neverSignedIn: NudgeTarget[] = [];
  const incompleteProfile: NudgeTarget[] = [];

  for (const r of rows) {
    const base = {
      userId: r.userId,
      staffId: r.staffId,
      name: r.staffName ?? r.name,
      email: r.email,
      companyName: r.companyName,
      tagCount: r.tagCount ?? 0,
    };

    if (!r.lastLoginAt) {
      neverSignedIn.push({
        ...base,
        missing: [],
        lastNudgeAt: r.lastLoginNudgeAt,
        dueForNudge: due(r.lastLoginNudgeAt, now),
      });
      continue;
    }

    // Signed in, but we can't tell them what's missing without a team-member
    // row to read it off. That's an admin gap, not theirs — leave them out.
    if (r.staffId == null) continue;

    const missing = missingProfileFields(r);
    if (missing.length === 0) continue;

    incompleteProfile.push({
      ...base,
      missing,
      lastNudgeAt: r.lastProfileNudgeAt,
      dueForNudge: due(r.lastProfileNudgeAt, now),
    });
  }

  // Untagged is asked separately: it covers everybody on the team list, not
  // just the ones with a login, because a costed tag bills per head whether or
  // not the person can sign in.
  const untaggedRows = await db
    .select({
      staffId: staff.id,
      name: staff.name,
      companyName: sql<string | null>`(select name from companies where id = ${staff.companyId})`,
    })
    .from(staff)
    .leftJoin(staffTags, eq(staffTags.staffId, staff.id))
    .where(and(eq(staff.active, true), isNull(staffTags.staffId)));

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    neverSignedIn: neverSignedIn.sort(byName),
    incompleteProfile: incompleteProfile.sort(byName),
    untagged: untaggedRows.sort(byName),
  };
}

export type NudgeRunResult = {
  signInSent: number;
  profileSent: number;
  failed: number;
  skipped: number;
  /** Set when nothing could be sent at all, rather than returning silent zeros. */
  error?: string;
};

/**
 * Sends both kinds of nudge.
 *
 * `onlyUserId` sends to one person and ignores the cooldown — that's the test
 * send on the review page, which has to work on demand or it isn't a test.
 * `ignoreCooldown` does the same for a manual "send to everyone now".
 */
export async function runProfileNudges(options: {
  trigger: "cron" | "manual";
  onlyUserId?: number;
  ignoreCooldown?: boolean;
} = { trigger: "cron" }): Promise<NudgeRunResult> {
  const empty = { signInSent: 0, profileSent: 0, failed: 0, skipped: 0 };
  if (!mailConfigured()) {
    return { ...empty, error: "No mail provider is configured, so nothing was sent." };
  }

  const { neverSignedIn, incompleteProfile } = await loadNudgeCandidates();
  const base = await appBaseUrl();
  const result: NudgeRunResult = { ...empty };

  const wanted = (t: NudgeTarget) =>
    options.onlyUserId != null
      ? t.userId === options.onlyUserId
      : options.ignoreCooldown || t.dueForNudge;

  for (const t of neverSignedIn) {
    if (!wanted(t)) {
      result.skipped++;
      continue;
    }
    const mail = signInNudgeEmail({
      name: t.name,
      email: t.email,
      loginUrl: `${base}/login`,
      forgotUrl: `${base}/forgot-password`,
      profileUrl: `${base}/account`,
    });
    const res = await sendMail({ to: t.email, subject: mail.subject, html: mail.html, text: mail.text });
    if (!res.ok) {
      result.failed++;
      continue;
    }
    result.signInSent++;
    await db
      .update(users)
      .set({ lastLoginNudgeAt: new Date() })
      .where(eq(users.id, t.userId));
  }

  for (const t of incompleteProfile) {
    if (!wanted(t)) {
      result.skipped++;
      continue;
    }
    const mail = profileNudgeEmail({
      name: t.name,
      missing: t.missing,
      profileUrl: `${base}/account`,
      directoryUrl: `${base}/meet-the-team`,
    });
    const res = await sendMail({ to: t.email, subject: mail.subject, html: mail.html, text: mail.text });
    if (!res.ok) {
      result.failed++;
      continue;
    }
    result.profileSent++;
    if (t.staffId != null) {
      await db
        .update(staff)
        .set({ lastProfileNudgeAt: new Date() })
        .where(eq(staff.id, t.staffId));
    }
  }

  return result;
}

/**
 * Sends BOTH nudges to one address, filled in with sample gaps.
 *
 * Needed because the per-row test send only exists for people who are in a
 * bucket — and whoever is about to email 72 colleagues is, hopefully, not one
 * of them. Without this there is no way to see what you are about to send.
 */
export async function sendNudgeSamples(to: string, name: string): Promise<NudgeRunResult> {
  const empty = { signInSent: 0, profileSent: 0, failed: 0, skipped: 0 };
  if (!mailConfigured()) {
    return { ...empty, error: "No mail provider is configured, so nothing was sent." };
  }
  const base = await appBaseUrl();
  const result: NudgeRunResult = { ...empty };

  const first = signInNudgeEmail({
    name,
    email: to,
    loginUrl: base + "/login",
    forgotUrl: base + "/forgot-password",
    profileUrl: base + "/account",
  });
  const a = await sendMail({ to, subject: "[Sample] " + first.subject, html: first.html, text: first.text });
  a.ok ? result.signInSent++ : result.failed++;

  const second = profileNudgeEmail({
    name,
    missing: PROFILE_FIELDS.map((f) => f.label),
    profileUrl: base + "/account",
    directoryUrl: base + "/meet-the-team",
  });
  const b = await sendMail({ to, subject: "[Sample] " + second.subject, html: second.html, text: second.text });
  b.ok ? result.profileSent++ : result.failed++;

  return result;
}

/** Is the weekly automatic run switched on? Off unless explicitly enabled. */
export async function nudgeAutoEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, NUDGE_AUTO_KEY))
    .limit(1);
  return row?.value === "on";
}

/**
 * The weekly tick, hung off the daily mail cron.
 *
 * Sends on Mondays only, and only when switched on. Returns a reason rather
 * than a bare zero for every no-op, because a reminder run that quietly does
 * nothing is indistinguishable from one that's broken.
 */
export async function runWeeklyProfileNudges(
  now: Date = new Date(),
): Promise<NudgeRunResult & { ran: boolean; reason?: string }> {
  const skipped = { signInSent: 0, profileSent: 0, failed: 0, skipped: 0, ran: false };
  if (!(await nudgeAutoEnabled())) {
    return { ...skipped, reason: "Automatic nudges are switched off." };
  }
  // SAST is UTC+2 year-round; +2h then read the UTC day.
  const sastDay = new Date(now.getTime() + 120 * 60_000).getUTCDay();
  if (sastDay !== 1) return { ...skipped, reason: "Not Monday." };

  const res = await runProfileNudges({ trigger: "cron" });
  return { ...res, ran: true };
}

/** Anybody at all to nudge? Used to keep an empty state honest. */
export function hasAnyone(c: NudgeCandidates): boolean {
  return c.neverSignedIn.length > 0 || c.incompleteProfile.length > 0 || c.untagged.length > 0;
}
