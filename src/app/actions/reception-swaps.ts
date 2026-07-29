"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { receptionSlots, receptionSwapRequests, staff, staffTags, tags } from "@/db/schema";
import { requireUser, hasPermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import {
  appBaseUrl,
  mailConfigured,
  receptionSwapOutcomeEmail,
  receptionSwapRequestEmail,
  sendMail,
} from "@/lib/mailer";
import { dayLabel, minutesToLabel, RECEPTION_TAG } from "@/lib/reception";

export type SwapState = { error?: string; ok?: boolean; note?: string };

/**
 * The signed-in user's own team-member record, if it carries the Reception tag.
 *
 * This is the gate for swapping, rather than a permission — swapping is
 * something you do with your own shift, and an admin who never sits at the desk
 * has no shift to trade. It also means the tag stays the single place where
 * "who does reception" is decided.
 */
async function myReceptionStaff(userId: number): Promise<{ id: number; name: string } | null> {
  const [tag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(sql`lower(${tags.name}) = ${RECEPTION_TAG.toLowerCase()}`)
    .limit(1);
  if (!tag) return null;

  const [row] = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .innerJoin(staffTags, and(eq(staffTags.staffId, staff.id), eq(staffTags.tagId, tag.id)))
    .where(and(eq(staff.userId, userId), eq(staff.active, true)))
    .limit(1);
  return row ?? null;
}

function slotText(date: string, startMinute: number, endMinute: number): string {
  return `${dayLabel(date)}, ${minutesToLabel(startMinute)}–${minutesToLabel(endMinute)}`;
}

export async function requestSwap(_prev: SwapState, formData: FormData): Promise<SwapState> {
  const user = await requireUser();
  const mine = await myReceptionStaff(user.id);
  if (!mine) {
    return {
      error: `Only team members tagged "${RECEPTION_TAG}" can swap shifts, and your login has to be linked to that team member.`,
    };
  }

  const fromSlotId = Number(formData.get("fromSlotId"));
  const toSlotId = Number(formData.get("toSlotId"));
  const message = String(formData.get("message") ?? "").trim() || null;
  if (!fromSlotId || !toSlotId) return { error: "Pick a shift to swap with." };
  if (fromSlotId === toSlotId) return { error: "That is the same shift." };

  const slots = await db
    .select()
    .from(receptionSlots)
    .where(inArray(receptionSlots.id, [fromSlotId, toSlotId]));
  const from = slots.find((s) => s.id === fromSlotId);
  const to = slots.find((s) => s.id === toSlotId);
  if (!from || !to) return { error: "One of those shifts no longer exists." };
  if (from.staffId !== mine.id) return { error: "That is not your shift to swap." };
  if (!to.staffId) return { error: "Nobody is on that shift — ask an admin to assign it to you." };
  if (to.staffId === mine.id) return { error: "That shift is already yours." };

  const [target] = await db
    .select({ id: staff.id, name: staff.name, email: staff.email, userId: staff.userId })
    .from(staff)
    .where(eq(staff.id, to.staffId))
    .limit(1);
  if (!target) return { error: "That person is no longer on the team list." };

  // One live request per pair of shifts, so a keen swapper can't fill an inbox.
  const [pending] = await db
    .select({ id: receptionSwapRequests.id })
    .from(receptionSwapRequests)
    .where(
      and(
        eq(receptionSwapRequests.fromSlotId, fromSlotId),
        eq(receptionSwapRequests.toSlotId, toSlotId),
        eq(receptionSwapRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pending) return { error: "You have already asked about this one — waiting on their reply." };

  const token = randomUUID();
  await db.insert(receptionSwapRequests).values({
    fromSlotId,
    toSlotId,
    requesterStaffId: mine.id,
    targetStaffId: target.id,
    message,
    token,
  });

  const mySlotText = slotText(from.date, from.startMinute, from.endMinute);
  const theirSlotText = slotText(to.date, to.startMinute, to.endMinute);

  let delivered = false;
  if (target.email && mailConfigured()) {
    const base = await appBaseUrl();
    const mail = receptionSwapRequestEmail({
      targetName: target.name,
      requesterName: mine.name,
      theirSlot: mySlotText,
      yourSlot: theirSlotText,
      message,
      approveUrl: `${base}/reception/swap/${token}?action=approve`,
      declineUrl: `${base}/reception/swap/${token}?action=decline`,
    });
    const res = await sendMail({
      to: target.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    delivered = res.ok;
  }

  await logEvent({
    action: "reception.swap_request",
    summary: `${mine.name} asked ${target.name} to swap ${mySlotText} for ${theirSlotText}`,
    actor: user,
    entityType: "reception",
    metadata: { fromSlotId, toSlotId, emailed: delivered },
  });

  revalidatePath("/reception");
  return {
    ok: true,
    note: delivered
      ? `Asked ${target.name}. They will get an email, and the rota only changes if they agree.`
      : target.email
        ? `Saved, but the email did not send — tell ${target.name} directly, they can still answer in the app.`
        : `Saved, but ${target.name} has no email address on the team list, so nothing was sent. Tell them directly.`,
  };
}

/**
 * The answer. Approving exchanges the two slots' assignees — the rota is the
 * record, so it changes here and nowhere else.
 */
export async function respondToSwap(_prev: SwapState, formData: FormData): Promise<SwapState> {
  const user = await requireUser();
  const token = String(formData.get("token") ?? "");
  const decision = formData.get("decision") === "approve" ? "approve" : "decline";
  const reason = String(formData.get("reason") ?? "").trim();
  if (decision === "decline" && !reason) {
    return { error: "Please say why — they will only see the reason you give." };
  }

  const [request] = await db
    .select()
    .from(receptionSwapRequests)
    .where(eq(receptionSwapRequests.token, token))
    .limit(1);
  if (!request) return { error: "That swap request no longer exists." };
  if (request.status !== "pending") return { error: "You have already answered this one." };

  const [target] = await db
    .select({ id: staff.id, name: staff.name, userId: staff.userId })
    .from(staff)
    .where(eq(staff.id, request.targetStaffId))
    .limit(1);
  const [requester] = await db
    .select({ id: staff.id, name: staff.name, email: staff.email })
    .from(staff)
    .where(eq(staff.id, request.requesterStaffId))
    .limit(1);

  // The token names the request; it does not authorise it. Only the person
  // being asked may answer — or an admin, since plenty of desk staff have no
  // login at all and would otherwise leave a request stuck forever.
  const isTarget = target?.userId === user.id;
  const canAnswer = isTarget || hasPermission(user, "reception.manage");
  if (!canAnswer) {
    return { error: `Only ${target?.name ?? "the person being asked"} can answer this.` };
  }

  const slots = await db
    .select()
    .from(receptionSlots)
    .where(inArray(receptionSlots.id, [request.fromSlotId, request.toSlotId]));
  const from = slots.find((s) => s.id === request.fromSlotId);
  const to = slots.find((s) => s.id === request.toSlotId);
  if (!from || !to) return { error: "One of those shifts has since been removed." };

  const fromText = slotText(from.date, from.startMinute, from.endMinute);
  const toText = slotText(to.date, to.startMinute, to.endMinute);

  if (decision === "approve") {
    // Guard against the rota having moved on since the ask — approving blind
    // would hand over a shift that is no longer either party's to give.
    if (from.staffId !== request.requesterStaffId || to.staffId !== request.targetStaffId) {
      await db
        .update(receptionSwapRequests)
        .set({ status: "withdrawn", respondedAt: new Date() })
        .where(eq(receptionSwapRequests.id, request.id));
      return { error: "The rota has changed since this was asked, so the swap no longer applies." };
    }

    await db
      .update(receptionSlots)
      .set({ staffId: request.targetStaffId })
      .where(eq(receptionSlots.id, request.fromSlotId));
    await db
      .update(receptionSlots)
      .set({ staffId: request.requesterStaffId })
      .where(eq(receptionSlots.id, request.toSlotId));
  }

  await db
    .update(receptionSwapRequests)
    .set({
      status: decision === "approve" ? "approved" : "declined",
      declineReason: decision === "decline" ? reason : null,
      respondedAt: new Date(),
    })
    .where(eq(receptionSwapRequests.id, request.id));

  if (requester?.email && mailConfigured()) {
    const base = await appBaseUrl();
    const mail = receptionSwapOutcomeEmail({
      requesterName: requester.name,
      targetName: target?.name ?? "They",
      approved: decision === "approve",
      yourSlot: toText,
      theirSlot: fromText,
      reason: decision === "decline" ? reason : null,
      rotaUrl: `${base}/reception`,
    });
    await sendMail({
      to: requester.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  }

  await logEvent({
    action: decision === "approve" ? "reception.swap_approved" : "reception.swap_declined",
    summary:
      decision === "approve"
        ? `Swapped reception shifts: ${requester?.name} takes ${toText}, ${target?.name} takes ${fromText}`
        : `Declined a reception swap between ${requester?.name} and ${target?.name}`,
    actor: user,
    entityType: "reception",
    metadata: { fromSlotId: request.fromSlotId, toSlotId: request.toSlotId },
  });

  revalidatePath("/reception");
  revalidatePath(`/reception/swap/${token}`);
  return { ok: true };
}

/** Pull a request you sent and no longer need. */
export async function withdrawSwap(requestId: number) {
  const user = await requireUser();
  const mine = await myReceptionStaff(user.id);
  const [request] = await db
    .select()
    .from(receptionSwapRequests)
    .where(eq(receptionSwapRequests.id, requestId))
    .limit(1);
  if (!request || request.status !== "pending") return;
  if (request.requesterStaffId !== mine?.id && !hasPermission(user, "reception.manage")) return;

  await db
    .update(receptionSwapRequests)
    .set({ status: "withdrawn", respondedAt: new Date() })
    .where(eq(receptionSwapRequests.id, requestId));
  revalidatePath("/reception");
}
