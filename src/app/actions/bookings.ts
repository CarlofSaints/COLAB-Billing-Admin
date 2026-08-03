"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  roomBookingAttendees,
  roomBookings,
  rooms,
  roomStealRequests,
  staff,
  users,
} from "@/db/schema";
import { requireUser, hasPermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import {
  appBaseUrl,
  bookingConfirmedEmail,
  bookingHandedOverEmail,
  bookingTakenOverEmail,
  mailConfigured,
  roomStealApprovedEmail,
  roomStealDeclinedEmail,
  roomStealRequestEmail,
  sendMail,
} from "@/lib/mailer";
import {
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  MIN_DURATION,
  describeRecurrence,
  expandRecurrence,
  findConflicts,
  longDateLabel,
  minuteLabel,
  parseDateKey,
  slotLabel,
  type Recurrence,
} from "@/lib/bookings";

export type BookingState = { error?: string; ok?: boolean; warning?: string };

const recurrenceSchema = z.object({
  frequency: z.enum(["none", "daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).max(12),
  weekdays: z.array(z.number().int().min(0).max(6)),
  endMode: z.enum(["count", "date"]),
  count: z.number().int().min(1).max(52),
  until: z.string(),
});

const bookingSchema = z.object({
  roomId: z.number().int().positive(),
  title: z.string().trim().min(1, "Give the meeting a name").max(120),
  date: z.string().refine((v) => parseDateKey(v) !== null, "Pick a valid date"),
  startMinute: z.number().int().min(0).max(24 * 60),
  endMinute: z.number().int().min(0).max(24 * 60),
  clientName: z.string().trim().max(120).optional(),
  attendeeCount: z.number().int().min(1).max(500),
  attendeeStaffIds: z.array(z.number().int().positive()),
  /** Booking for someone else. 0 / absent means it's for the booker. */
  bookedForUserId: z.number().int().nonnegative(),
  recurrence: recurrenceSchema,
});

function readBookingForm(formData: FormData) {
  const raw = String(formData.get("recurrence") ?? "");
  let recurrence: unknown;
  try {
    recurrence = raw ? JSON.parse(raw) : null;
  } catch {
    recurrence = null;
  }

  return bookingSchema.safeParse({
    roomId: Number(formData.get("roomId")),
    title: formData.get("title"),
    date: String(formData.get("date") ?? ""),
    startMinute: Number(formData.get("startMinute")),
    endMinute: Number(formData.get("endMinute")),
    clientName: String(formData.get("clientName") ?? "").trim() || undefined,
    attendeeCount: Number(formData.get("attendeeCount") || 1),
    attendeeStaffIds: formData
      .getAll("attendeeStaffId")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0),
    bookedForUserId: Number(formData.get("bookedForUserId") || 0),
    recurrence,
  });
}

function revalidateBookingPaths() {
  revalidatePath("/bookings");
  revalidatePath("/hub");
}

type HolderFields = {
  bookedByUserId: number | null;
  bookedByName: string;
  bookedByEmail: string;
  bookedForUserId: number | null;
  bookedForName: string | null;
  bookedForEmail: string | null;
};

/**
 * A booking made on someone's behalf has two holders. Both may cancel it and
 * both may answer a request for the room — otherwise a request stalls whenever
 * the person who happened to click the button is out of the office.
 */
function isHolderOf(booking: HolderFields, userId: number): boolean {
  return booking.bookedByUserId === userId || booking.bookedForUserId === userId;
}

/** Everyone who should hear about this booking, de-duplicated by address. */
function holderRecipients(booking: HolderFields): { name: string; email: string }[] {
  const out = [{ name: booking.bookedByName, email: booking.bookedByEmail }];
  if (booking.bookedForEmail && booking.bookedForEmail !== booking.bookedByEmail) {
    out.push({
      name: booking.bookedForName ?? booking.bookedForEmail,
      email: booking.bookedForEmail,
    });
  }
  return out;
}

/** "Sarah (booked by Jane)" — how a two-person booking reads in one line. */
function holderLabel(booking: HolderFields): string {
  return booking.bookedForName
    ? `${booking.bookedForName} (booked by ${booking.bookedByName})`
    : booking.bookedByName;
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export async function createBooking(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const user = await requireUser();
  if (!hasPermission(user, "hub.view")) return { error: "You can't book rooms." };

  const parsed = readBookingForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  if (input.endMinute - input.startMinute < MIN_DURATION) {
    return { error: `A meeting has to be at least ${MIN_DURATION} minutes long.` };
  }
  if (input.startMinute < DAY_START_MINUTE || input.endMinute > DAY_END_MINUTE) {
    return {
      error: `Bookings run between ${minuteLabel(DAY_START_MINUTE)} and ${minuteLabel(DAY_END_MINUTE)}.`,
    };
  }

  const [room] = await db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1);
  if (!room || !room.active) return { error: "That room isn't available." };
  if (input.attendeeCount > room.capacity) {
    return {
      error: `${room.name} seats ${room.capacity}. Pick a bigger room or reduce the headcount.`,
    };
  }

  const recurrence = input.recurrence as Recurrence;
  const dates = expandRecurrence(input.date, recurrence);
  if (dates.length === 0) return { error: "That repeat pattern doesn't produce any dates." };

  const proposed = dates.map((date) => ({
    date,
    startMinute: input.startMinute,
    endMinute: input.endMinute,
  }));

  // Everything already in this room across the span we're about to write.
  const existing = await db
    .select({
      id: roomBookings.id,
      date: roomBookings.date,
      startMinute: roomBookings.startMinute,
      endMinute: roomBookings.endMinute,
      title: roomBookings.title,
      bookedByName: roomBookings.bookedByName,
    })
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.roomId, input.roomId),
        eq(roomBookings.status, "confirmed"),
        gte(roomBookings.date, dates[0]),
        lte(roomBookings.date, dates[dates.length - 1]),
      ),
    );

  const conflicts = findConflicts(proposed, existing);
  if (conflicts.length > 0) {
    // Refuse the whole thing rather than quietly booking the dates that happen
    // to be free — a half-booked series is worse than a clear error.
    const first = conflicts[0];
    const more =
      conflicts.length > 1 ? ` (and ${conflicts.length - 1} other date${conflicts.length > 2 ? "s" : ""})` : "";
    return {
      error:
        `${room.name} is already taken on ${longDateLabel(first.slot.date)} at ` +
        `${minuteLabel(first.clash.startMinute)} — "${first.clash.title}" by ${first.clash.bookedByName}${more}.`,
    };
  }

  // Booking on someone else's behalf. Both people are treated as holders from
  // here on — reminders, requests for the room, and the right to answer them.
  let bookedFor: { id: number; name: string; email: string } | null = null;
  if (input.bookedForUserId && input.bookedForUserId !== user.id) {
    const [target] = await db
      .select({ id: users.id, name: users.name, email: users.email, active: users.active })
      .from(users)
      .where(eq(users.id, input.bookedForUserId))
      .limit(1);
    if (!target || !target.active) return { error: "That person can't be booked for." };
    bookedFor = { id: target.id, name: target.name, email: target.email };
  }

  const isSeries = dates.length > 1;
  const seriesId = isSeries ? randomUUID() : null;
  const recurrenceLabel = isSeries ? describeRecurrence(recurrence) : null;

  const inserted = await db
    .insert(roomBookings)
    .values(
      dates.map((date) => ({
        roomId: input.roomId,
        title: input.title,
        date,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        bookedByUserId: user.id,
        bookedByName: user.name,
        bookedByEmail: user.email,
        bookedForUserId: bookedFor?.id ?? null,
        bookedForName: bookedFor?.name ?? null,
        bookedForEmail: bookedFor?.email ?? null,
        clientName: input.clientName ?? null,
        attendeeCount: input.attendeeCount,
        seriesId,
        recurrenceLabel,
      })),
    )
    .returning({ id: roomBookings.id });

  if (input.attendeeStaffIds.length > 0) {
    await db.insert(roomBookingAttendees).values(
      inserted.flatMap((b) =>
        input.attendeeStaffIds.map((staffId) => ({ bookingId: b.id, staffId })),
      ),
    );
  }

  await logEvent({
    action: "booking.create",
    summary:
      `Booked ${room.name} for "${input.title}" on ${longDateLabel(input.date)} ` +
      `${slotLabel(input.startMinute, input.endMinute)}` +
      (bookedFor ? ` on behalf of ${bookedFor.name}` : "") +
      (isSeries ? ` — ${recurrenceLabel} (${dates.length} bookings)` : ""),
    actor: user,
    entityType: "room_booking",
    entityId: inserted[0]?.id,
  });

  const attendeeNames = await namesFor(input.attendeeStaffIds);
  const details = {
    roomName: room.name,
    title: input.title,
    date: input.date,
    startMinute: input.startMinute,
    endMinute: input.endMinute,
    attendeeCount: input.attendeeCount,
    clientName: input.clientName ?? null,
    attendees: attendeeNames,
    recurrenceLabel,
    occurrences: dates.length,
    bookedForName: bookedFor?.name ?? null,
    bookedByName: user.name,
  };

  // Both holders get the confirmation, so the person the room is for knows it
  // exists without being told separately.
  const emailed = await sendBookingConfirmation({
    ...details,
    to: user.email,
    bookerName: user.name,
  });
  if (bookedFor) {
    await sendBookingConfirmation({ ...details, to: bookedFor.email, bookerName: bookedFor.name });
  }

  revalidateBookingPaths();
  return {
    ok: true,
    warning: emailed ? undefined : "Booked — but the confirmation email couldn't be sent.",
  };
}

async function namesFor(staffIds: number[]): Promise<string[]> {
  if (staffIds.length === 0) return [];
  const rows = await db
    .select({ name: staff.name })
    .from(staff)
    .where(inArray(staff.id, staffIds));
  return rows.map((r) => r.name);
}

async function sendBookingConfirmation(input: {
  to: string;
  bookerName: string;
  roomName: string;
  title: string;
  date: string;
  startMinute: number;
  endMinute: number;
  attendeeCount: number;
  clientName: string | null;
  attendees: string[];
  recurrenceLabel: string | null;
  occurrences: number;
  bookedForName?: string | null;
  bookedByName?: string | null;
}): Promise<boolean> {
  if (!mailConfigured()) return false;
  const base = await appBaseUrl();
  const mail = bookingConfirmedEmail({
    bookerName: input.bookerName,
    roomName: input.roomName,
    title: input.title,
    dateLabel: longDateLabel(input.date),
    timeLabel: slotLabel(input.startMinute, input.endMinute),
    attendeeCount: input.attendeeCount,
    clientName: input.clientName,
    attendees: input.attendees,
    recurrenceLabel: input.recurrenceLabel,
    occurrences: input.occurrences,
    bookedForName: input.bookedForName,
    bookedByName: input.bookedByName,
    bookingsUrl: `${base}/bookings`,
  });
  const res = await sendMail({
    to: input.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  return res.ok;
}

/* ------------------------------------------------------------------ */
/* Edit                                                                */
/* ------------------------------------------------------------------ */

/**
 * Change an existing booking — time, room, details, attendees.
 *
 * Only ever touches this one occurrence. Editing a whole series would need to
 * decide what to do with occurrences that have already been handed over or
 * moved, and silently rewriting those is worse than making someone edit the
 * two dates they actually care about.
 */
export async function updateBooking(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!id) return { error: "Missing booking id" };

  const [booking] = await db.select().from(roomBookings).where(eq(roomBookings.id, id)).limit(1);
  if (!booking) return { error: "That booking no longer exists." };
  if (booking.status !== "confirmed") return { error: "That booking has been cancelled." };
  if (!isHolderOf(booking, user.id) && !hasPermission(user, "bookings.manage")) {
    return { error: "Only the people holding this room can change it." };
  }

  const parsed = readBookingForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  if (input.endMinute - input.startMinute < MIN_DURATION) {
    return { error: `A meeting has to be at least ${MIN_DURATION} minutes long.` };
  }
  if (input.startMinute < DAY_START_MINUTE || input.endMinute > DAY_END_MINUTE) {
    return {
      error: `Bookings run between ${minuteLabel(DAY_START_MINUTE)} and ${minuteLabel(DAY_END_MINUTE)}.`,
    };
  }

  const [room] = await db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1);
  if (!room || !room.active) return { error: "That room isn't available." };
  if (input.attendeeCount > room.capacity) {
    return { error: `${room.name} seats ${room.capacity}.` };
  }

  // Re-check the slot, excluding this booking — otherwise it would always
  // collide with itself.
  const clashes = await db
    .select({
      id: roomBookings.id,
      date: roomBookings.date,
      startMinute: roomBookings.startMinute,
      endMinute: roomBookings.endMinute,
      title: roomBookings.title,
      bookedByName: roomBookings.bookedByName,
    })
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.roomId, input.roomId),
        eq(roomBookings.status, "confirmed"),
        eq(roomBookings.date, input.date),
        ne(roomBookings.id, id),
      ),
    );

  const conflict = findConflicts(
    [{ date: input.date, startMinute: input.startMinute, endMinute: input.endMinute }],
    clashes,
  )[0];
  if (conflict) {
    return {
      error:
        `${room.name} is already taken at ${minuteLabel(conflict.clash.startMinute)} — ` +
        `"${conflict.clash.title}" by ${conflict.clash.bookedByName}.`,
    };
  }

  // Who the room is for can be changed here too. 0 — and picking the person who
  // made the booking — both mean "it's simply theirs again", which is how the
  // calendar reads a null `bookedFor` (`bookedForName ?? bookedByName`). Storing
  // someone as both booker and bookee would show "Booked for Jane, booked by
  // Jane" on every screen and in every email.
  let bookedFor: { id: number; name: string; email: string } | null = null;
  if (input.bookedForUserId && input.bookedForUserId !== booking.bookedByUserId) {
    const [target] = await db
      .select({ id: users.id, name: users.name, email: users.email, active: users.active })
      .from(users)
      .where(eq(users.id, input.bookedForUserId))
      .limit(1);
    if (!target || !target.active) return { error: "That person can't be booked for." };
    bookedFor = { id: target.id, name: target.name, email: target.email };
  }

  const holderChanged = (bookedFor?.id ?? null) !== booking.bookedForUserId;

  // Moving a booking to a new day or time means the day-before reminder that
  // may already have gone is now wrong, so let it send again. Handing it to
  // someone else counts for the same reason: if the reminder has already gone
  // out, the new holder would otherwise never be nudged about it at all.
  const moved =
    booking.date !== input.date ||
    booking.startMinute !== input.startMinute ||
    booking.endMinute !== input.endMinute;

  await db
    .update(roomBookings)
    .set({
      roomId: input.roomId,
      title: input.title,
      date: input.date,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      bookedForUserId: bookedFor?.id ?? null,
      bookedForName: bookedFor?.name ?? null,
      bookedForEmail: bookedFor?.email ?? null,
      clientName: input.clientName ?? null,
      attendeeCount: input.attendeeCount,
      ...(moved || holderChanged ? { reminderSentAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(roomBookings.id, id));

  await db.delete(roomBookingAttendees).where(eq(roomBookingAttendees.bookingId, id));
  if (input.attendeeStaffIds.length > 0) {
    await db
      .insert(roomBookingAttendees)
      .values(input.attendeeStaffIds.map((staffId) => ({ bookingId: id, staffId })));
  }

  // Who held it before, and who holds it now. A booking with no `bookedFor` is
  // held by whoever made it, so both sides always resolve to a real person.
  const previousHolder = {
    name: booking.bookedForName ?? booking.bookedByName,
    email: booking.bookedForEmail ?? booking.bookedByEmail,
    // The booker is a holder whoever the room is for, and the booker is never
    // changed by an edit. So someone who booked the room for themselves keeps
    // the reminder and keeps fielding requests for it — the opposite of what
    // happens to a person another had booked it for.
    stillHolderAsBooker: booking.bookedForEmail === null,
  };
  const newHolder = {
    name: bookedFor?.name ?? booking.bookedByName,
    email: bookedFor?.email ?? booking.bookedByEmail,
  };

  await logEvent({
    action: "booking.update",
    summary:
      `Edited "${input.title}" in ${room.name} — ${longDateLabel(input.date)} ` +
      `${slotLabel(input.startMinute, input.endMinute)}` +
      (holderChanged ? ` — now for ${newHolder.name} (was ${previousHolder.name})` : ""),
    actor: user,
    entityType: "room_booking",
    entityId: id,
  });

  let warning: string | undefined;

  if (holderChanged) {
    const attendeeNames = await namesFor(input.attendeeStaffIds);
    const details = {
      roomName: room.name,
      title: input.title,
      dateLabel: longDateLabel(input.date),
      timeLabel: slotLabel(input.startMinute, input.endMinute),
      attendeeCount: input.attendeeCount,
      clientName: input.clientName ?? null,
      attendees: attendeeNames,
      recurrenceLabel: booking.recurrenceLabel,
      bookedForName: bookedFor?.name ?? null,
      bookedByName: booking.bookedByName,
    };

    // Nobody is told about their own edit — they just made it. Everyone else on
    // either side of the handover hears, so a booking never moves in or out of
    // someone's name without a word.
    const sent = await sendHandoverEmails({
      details,
      changedByName: user.name,
      previousHolder,
      newHolder,
      skipEmail: user.email,
    });
    if (!sent) warning = "Saved — but the handover email couldn't be sent.";
  }

  revalidateBookingPaths();
  return { ok: true, warning };
}

/**
 * Tell both sides that a booking has changed hands. Returns false only if a
 * message was due and failed, so the caller can say so rather than implying
 * someone has been told when they haven't.
 */
async function sendHandoverEmails(input: {
  details: {
    roomName: string;
    title: string;
    dateLabel: string;
    timeLabel: string;
    attendeeCount: number;
    clientName: string | null;
    attendees: string[];
    recurrenceLabel: string | null;
    bookedForName: string | null;
    bookedByName: string;
  };
  changedByName: string;
  previousHolder: { name: string; email: string; stillHolderAsBooker: boolean };
  newHolder: { name: string; email: string };
  skipEmail: string;
}): Promise<boolean> {
  if (!mailConfigured()) return false;
  const base = await appBaseUrl();
  const bookingsUrl = `${base}/bookings`;
  let ok = true;

  if (input.newHolder.email !== input.skipEmail) {
    const mail = bookingHandedOverEmail({
      ...input.details,
      holderName: input.newHolder.name,
      previousHolderName: input.previousHolder.name,
      changedByName: input.changedByName,
      bookingsUrl,
    });
    const res = await sendMail({
      to: input.newHolder.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (!res.ok) ok = false;
  }

  if (
    input.previousHolder.email !== input.skipEmail &&
    input.previousHolder.email !== input.newHolder.email
  ) {
    const mail = bookingTakenOverEmail({
      ...input.details,
      previousHolderName: input.previousHolder.name,
      newHolderName: input.newHolder.name,
      changedByName: input.changedByName,
      stillHolderAsBooker: input.previousHolder.stillHolderAsBooker,
      bookingsUrl,
    });
    const res = await sendMail({
      to: input.previousHolder.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (!res.ok) ok = false;
  }

  return ok;
}

/* ------------------------------------------------------------------ */
/* Cancel                                                              */
/* ------------------------------------------------------------------ */

export async function cancelBooking(id: number, scope: "one" | "series" = "one") {
  const user = await requireUser();
  const [booking] = await db.select().from(roomBookings).where(eq(roomBookings.id, id)).limit(1);
  if (!booking) return;

  const isOwner = isHolderOf(booking, user.id);
  if (!isOwner && !hasPermission(user, "bookings.manage")) return;

  if (scope === "series" && booking.seriesId) {
    await db
      .update(roomBookings)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(eq(roomBookings.seriesId, booking.seriesId), eq(roomBookings.status, "confirmed")),
      );
  } else {
    await db
      .update(roomBookings)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(roomBookings.id, id));
  }

  // Any outstanding requests for a cancelled slot are moot.
  await db
    .update(roomStealRequests)
    .set({ status: "withdrawn", respondedAt: new Date() })
    .where(and(eq(roomStealRequests.bookingId, id), eq(roomStealRequests.status, "pending")));

  await logEvent({
    action: "booking.cancel",
    summary:
      `Cancelled ${scope === "series" ? "the whole series of " : ""}"${booking.title}" on ` +
      `${longDateLabel(booking.date)}` +
      (isOwner ? "" : ` (held by ${holderLabel(booking)})`),
    actor: user,
    entityType: "room_booking",
    entityId: id,
  });

  revalidateBookingPaths();
}

/* ------------------------------------------------------------------ */
/* Steal the room                                                      */
/* ------------------------------------------------------------------ */

const stealSchema = z.object({
  bookingId: z.number().int().positive(),
  title: z.string().trim().min(1, "What do you need the room for?").max(120),
  message: z.string().trim().min(1, "Give them a reason — they're being asked to move").max(1000),
  clientName: z.string().trim().max(120).optional(),
  attendeeCount: z.number().int().min(1).max(500),
});

export async function requestSteal(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const user = await requireUser();
  if (!hasPermission(user, "hub.view")) return { error: "You can't book rooms." };

  const parsed = stealSchema.safeParse({
    bookingId: Number(formData.get("bookingId")),
    title: formData.get("title"),
    message: formData.get("message"),
    clientName: String(formData.get("clientName") ?? "").trim() || undefined,
    attendeeCount: Number(formData.get("attendeeCount") || 1),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  const [booking] = await db
    .select()
    .from(roomBookings)
    .where(eq(roomBookings.id, input.bookingId))
    .limit(1);
  if (!booking || booking.status !== "confirmed") return { error: "That booking is no longer live." };
  if (isHolderOf(booking, user.id)) return { error: "You already have this room." };

  const [room] = await db.select().from(rooms).where(eq(rooms.id, booking.roomId)).limit(1);
  if (room && input.attendeeCount > room.capacity) {
    return { error: `${room.name} only seats ${room.capacity}.` };
  }

  // One live request per person per booking, so a keen requester can't spam
  // the holder's inbox.
  const [pending] = await db
    .select({ id: roomStealRequests.id })
    .from(roomStealRequests)
    .where(
      and(
        eq(roomStealRequests.bookingId, input.bookingId),
        eq(roomStealRequests.requesterUserId, user.id),
        eq(roomStealRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pending) return { error: "You've already asked for this one — waiting on their reply." };

  const token = randomUUID();
  await db.insert(roomStealRequests).values({
    bookingId: input.bookingId,
    requesterUserId: user.id,
    requesterName: user.name,
    requesterEmail: user.email,
    message: input.message,
    title: input.title,
    clientName: input.clientName ?? null,
    attendeeCount: input.attendeeCount,
    token,
  });

  let delivered = false;
  if (mailConfigured()) {
    const base = await appBaseUrl();
    // Both holders are asked, and either can answer — whoever gets to it first.
    for (const holder of holderRecipients(booking)) {
      const mail = roomStealRequestEmail({
        holderName: holder.name,
        requesterName: user.name,
        requesterMeeting: input.title,
        message: input.message,
        roomName: room?.name ?? "the room",
        dateLabel: longDateLabel(booking.date),
        timeLabel: slotLabel(booking.startMinute, booking.endMinute),
        yourMeeting: booking.title,
        approveUrl: `${base}/bookings/request/${token}?action=approve`,
        declineUrl: `${base}/bookings/request/${token}?action=decline`,
      });
      const res = await sendMail({
        to: holder.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      if (res.ok) delivered = true;
    }
  }

  await logEvent({
    action: "booking.steal_request",
    summary: `Asked ${holderLabel(booking)} for ${room?.name ?? "a room"} on ${longDateLabel(booking.date)}${delivered ? "" : " (email failed)"}`,
    actor: user,
    entityType: "room_booking",
    entityId: input.bookingId,
  });

  revalidateBookingPaths();
  return {
    ok: true,
    warning: delivered
      ? undefined
      : "Request saved, but the email didn't send — tell them in person, they can still respond in the app.",
  };
}

/**
 * The holder's answer. Approving hands the slot over in place: the booking
 * keeps its room and time but becomes the requester's meeting. Freeing the
 * slot and asking them to re-book would leave a window for someone else to
 * take it.
 */
export async function respondToSteal(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const user = await requireUser();
  const token = String(formData.get("token") ?? "");
  const decision = formData.get("decision") === "approve" ? "approve" : "decline";
  const reason = String(formData.get("reason") ?? "").trim();

  if (decision === "decline" && !reason) {
    return { error: "Please say why — they'll only see the reason you give." };
  }

  const [request] = await db
    .select()
    .from(roomStealRequests)
    .where(eq(roomStealRequests.token, token))
    .limit(1);
  if (!request) return { error: "That request no longer exists." };
  if (request.status !== "pending") return { error: "You've already answered this one." };

  const [booking] = await db
    .select()
    .from(roomBookings)
    .where(eq(roomBookings.id, request.bookingId))
    .limit(1);
  if (!booking) return { error: "That booking no longer exists." };

  // The token names the request; it does not authorise it. Only the person
  // holding the room (or an admin) can answer.
  const isHolder = isHolderOf(booking, user.id);
  if (!isHolder && !hasPermission(user, "bookings.manage")) {
    return { error: "Only the person who booked the room can answer this." };
  }
  if (booking.status !== "confirmed") return { error: "That booking has since been cancelled." };

  const [room] = await db.select().from(rooms).where(eq(rooms.id, booking.roomId)).limit(1);
  const base = mailConfigured() ? await appBaseUrl() : null;

  if (decision === "approve") {
    await db
      .update(roomBookings)
      .set({
        title: request.title,
        bookedByUserId: request.requesterUserId,
        bookedByName: request.requesterName,
        bookedByEmail: request.requesterEmail,
        // The slot has changed hands, so the previous "booked for" person is no
        // longer a holder — leaving it would keep emailing them about a meeting
        // that is no longer theirs, and let them answer requests for it.
        bookedForUserId: null,
        bookedForName: null,
        bookedForEmail: null,
        clientName: request.clientName,
        attendeeCount: request.attendeeCount,
        // A handed-over occurrence is its own booking now — it must not be
        // swept up by a later "cancel the whole series" by the old holder.
        seriesId: null,
        recurrenceLabel: null,
        reminderSentAt: null,
        updatedAt: new Date(),
      })
      .where(eq(roomBookings.id, booking.id));

    // The previous holder's guest list doesn't belong to the new meeting.
    await db.delete(roomBookingAttendees).where(eq(roomBookingAttendees.bookingId, booking.id));

    await db
      .update(roomStealRequests)
      .set({ status: "approved", respondedAt: new Date() })
      .where(eq(roomStealRequests.id, request.id));

    // Any other outstanding asks for this slot are now against a booking that
    // has changed hands, so retire them rather than leave them answerable.
    await db
      .update(roomStealRequests)
      .set({ status: "withdrawn", respondedAt: new Date() })
      .where(
        and(
          eq(roomStealRequests.bookingId, booking.id),
          eq(roomStealRequests.status, "pending"),
          ne(roomStealRequests.id, request.id),
        ),
      );

    if (base) {
      const mail = roomStealApprovedEmail({
        requesterName: request.requesterName,
        holderName: holderLabel(booking),
        roomName: room?.name ?? "the room",
        dateLabel: longDateLabel(booking.date),
        timeLabel: slotLabel(booking.startMinute, booking.endMinute),
        title: request.title,
        bookingsUrl: `${base}/bookings`,
      });
      await sendMail({
        to: request.requesterEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
    }

    await logEvent({
      action: "booking.steal_approved",
      summary: `Gave ${room?.name ?? "a room"} on ${longDateLabel(booking.date)} to ${request.requesterName}`,
      actor: user,
      entityType: "room_booking",
      entityId: booking.id,
    });
  } else {
    await db
      .update(roomStealRequests)
      .set({ status: "declined", declineReason: reason, respondedAt: new Date() })
      .where(eq(roomStealRequests.id, request.id));

    if (base) {
      const mail = roomStealDeclinedEmail({
        requesterName: request.requesterName,
        holderName: holderLabel(booking),
        roomName: room?.name ?? "the room",
        dateLabel: longDateLabel(booking.date),
        timeLabel: slotLabel(booking.startMinute, booking.endMinute),
        reason,
        bookingsUrl: `${base}/bookings`,
      });
      await sendMail({
        to: request.requesterEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
    }

    await logEvent({
      action: "booking.steal_declined",
      summary: `Declined ${request.requesterName}'s request for ${room?.name ?? "a room"} on ${longDateLabel(booking.date)}`,
      actor: user,
      entityType: "room_booking",
      entityId: booking.id,
    });
  }

  revalidateBookingPaths();
  revalidatePath(`/bookings/request/${token}`);
  return { ok: true };
}
