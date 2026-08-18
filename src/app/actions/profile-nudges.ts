"use server";

/**
 * ⚠️ Every export of a `"use server"` file is a public POST endpoint. Only the
 * three form actions belong here — the candidate loader stays in
 * lib/profile-nudges.ts, because a callable `loadNudgeCandidates()` would hand
 * anybody the full staff list with email addresses attached.
 */

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { NUDGE_AUTO_KEY, runProfileNudges, sendNudgeSamples } from "@/lib/profile-nudges";

export type NudgeActionState = { error?: string; ok?: string };

function summarise(res: {
  signInSent: number;
  profileSent: number;
  failed: number;
}): string {
  const parts: string[] = [];
  if (res.signInSent) parts.push(`${res.signInSent} sign-in reminder(s)`);
  if (res.profileSent) parts.push(`${res.profileSent} profile reminder(s)`);
  if (parts.length === 0) parts.push("nothing — nobody was due");
  const failed = res.failed ? `, ${res.failed} failed to send` : "";
  return `Sent ${parts.join(" and ")}${failed}.`;
}

/** Send one person their nudge, cooldown ignored — this is the test send. */
export async function sendOneNudge(
  _prev: NudgeActionState,
  formData: FormData,
): Promise<NudgeActionState> {
  const actor = await requirePermission("team.invite");
  const userId = Number(formData.get("userId"));
  if (!Number.isInteger(userId) || userId <= 0) return { error: "Pick somebody to send to." };

  const res = await runProfileNudges({ trigger: "manual", onlyUserId: userId });
  if (res.error) return { error: res.error };
  if (res.failed > 0) return { error: "The send failed — check the mail provider on Integrations." };
  if (res.signInSent + res.profileSent === 0) {
    return { error: "Nothing to send to that person — they're not in either list any more." };
  }

  await logEvent({
    action: "nudge.test_send",
    summary: `Sent a test profile nudge to user #${userId}`,
    actor,
    entityType: "user",
    entityId: userId,
  });
  revalidatePath("/profile-nudges");
  return { ok: summarise(res) };
}

/**
 * Send to everyone currently listed, cooldown ignored.
 *
 * This one goes to real people's inboxes and cannot be recalled, so the button
 * that calls it confirms first.
 */
export async function sendAllNudges(
  _prev: NudgeActionState,
  _formData: FormData,
): Promise<NudgeActionState> {
  const actor = await requirePermission("team.invite");

  const res = await runProfileNudges({ trigger: "manual", ignoreCooldown: true });
  if (res.error) return { error: res.error };

  await logEvent({
    action: "nudge.bulk_send",
    summary: `${summarise(res)} (sent by hand)`,
    actor,
    entityType: "user",
  });
  revalidatePath("/profile-nudges");
  return { ok: summarise(res) };
}

/**
 * Send both nudges to yourself, filled in with sample gaps.
 *
 * Goes to the signed-in user's own address and nowhere else — the address is
 * never read off the form, so this can't be turned into a way to mail an
 * arbitrary person from a public endpoint.
 */
export async function sendSamplesToMe(
  _prev: NudgeActionState,
  _formData: FormData,
): Promise<NudgeActionState> {
  const actor = await requirePermission("team.invite");

  const res = await sendNudgeSamples(actor.email, actor.name);
  if (res.error) return { error: res.error };
  if (res.failed > 0) {
    return { error: `${res.failed} of the 2 samples failed to send — check Integrations.` };
  }

  await logEvent({
    action: "nudge.sample_send",
    summary: `Sent both nudge samples to ${actor.email}`,
    actor,
    entityType: "user",
  });
  return { ok: `Both samples are on their way to ${actor.email}.` };
}

/** Switch the Monday automatic run on or off. */
export async function setNudgeAuto(
  _prev: NudgeActionState,
  formData: FormData,
): Promise<NudgeActionState> {
  const actor = await requirePermission("team.invite");
  const on = formData.get("enabled") === "on";

  await db
    .insert(appSettings)
    .values({ key: NUDGE_AUTO_KEY, value: on ? "on" : "off" })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: on ? "on" : "off", updatedAt: new Date() },
    });

  await logEvent({
    action: "nudge.auto_toggle",
    summary: `Weekly profile nudges switched ${on ? "ON" : "OFF"}`,
    actor,
    entityType: "setting",
  });
  revalidatePath("/profile-nudges");
  return { ok: on ? "Weekly nudges are on — they go out on Mondays." : "Weekly nudges are off." };
}
