"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, vehicleBookings, vehicleStealRequests, vehicles } from "@/db/schema";
import { hasPermission, requirePermission, type SessionUser } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import {
  appBaseUrl,
  mailConfigured,
  sendMail,
  vehicleBookedEmail,
  vehicleBookingCancelledEmail,
  vehicleReturnedEmail,
  vehicleStealApprovedEmail,
  vehicleStealDeclinedEmail,
  vehicleStealRequestEmail,
} from "@/lib/mailer";
import { extraRecipients } from "@/lib/notifications";
import { storePrivatePhoto } from "@/lib/private-photo";
import {
  assertCanBookVehicle,
  canReturnBooking,
  getBookerScope,
} from "@/lib/vehicle-access";
import {
  FUEL_LEVELS,
  MAX_MILEAGE,
  MAX_REFUEL_AMOUNT,
  REFUEL_PAYERS,
  formatDateTime,
  formatMileage,
  formatRand,
  fromDateTimeInput,
  fuelLabel,
  mileageDifference,
  refuelPayerLabel,
  type FuelLevel,
  type RefuelPayer,
} from "@/lib/vehicle-bookings";

/**
 * The booking that's in the way, handed back to the form so it can name who has
 * the vehicle and offer to ask them for it — rather than just refusing.
 */
export type VehicleConflict = {
  bookingId: number;
  vehicleName: string;
  holderName: string;
  fromLabel: string;
  toLabel: string;
  /** Out now and past its expected return, which is worth saying differently. */
  overdue: boolean;
  /** Their own booking. Asking yourself for the vehicle isn't a thing. */
  isMine: boolean;
};

export type VehicleBookingState = {
  error?: string;
  ok?: boolean;
  /** Saved, but something worth saying happened — an email that didn't send. */
  warning?: string;
  conflict?: VehicleConflict;
};

const fuelValues = FUEL_LEVELS.map((f) => f.value) as [FuelLevel, ...FuelLevel[]];
const payerValues = REFUEL_PAYERS.map((p) => p.value) as [RefuelPayer, ...RefuelPayer[]];

const mileage = z
  .number({ message: "Enter the mileage as a number" })
  .int("Mileage is a whole number of kilometres")
  .min(0, "Mileage can't be negative")
  .max(MAX_MILEAGE, "That mileage looks like a typo — check the odometer");

/**
 * A reading that may be left out — but is still a real odometer reading if it's
 * there. Whether blank is *allowed* is the vehicle's business (see
 * `vehicles.mileage_required`) and is checked against the database, not here.
 */
const optionalMileage = mileage.nullable();

/** Blank, whitespace or a non-number all mean "not given"; anything else parses. */
function readMileage(raw: FormDataEntryValue | null): number | null {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  return Number(text);
}

/**
 * A wall-clock date and time typed in Johannesburg. Parsed by
 * `fromDateTimeInput` rather than by `new Date(...)`, which would read the
 * timezone of whatever machine happened to run it.
 */
const dateTime = z
  .string()
  .trim()
  .min(1, "Pick a date and time")
  .transform((v, ctx) => {
    const parsed = fromDateTimeInput(v);
    if (!parsed) {
      ctx.addIssue({ code: "custom", message: "That isn't a valid date and time" });
      return z.NEVER;
    }
    return parsed;
  });

const createSchema = z
  .object({
    vehicleId: z.number().int().positive("Pick a vehicle"),
    takenOutAt: dateTime,
    expectedReturnAt: dateTime,
    bookedForUserId: z.number().int().nonnegative(),
    forService: z.boolean(),
    /** Why the vehicle is being taken. Optional — the form is meant to be quick. */
    purpose: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.expectedReturnAt.getTime() > v.takenOutAt.getTime(), {
    message: "The expected return has to be after the time the vehicle is taken",
    path: ["expectedReturnAt"],
  });

const returnSchema = z
  .object({
    bookingId: z.number().int().positive(),
    openingMileage: optionalMileage,
    closingMileage: optionalMileage,
    openingFuel: z.enum(fuelValues, { message: "Say how full the tank was when you took it" }),
    closingFuel: z.enum(fuelValues, { message: "Say how full the tank is now" }),
    notes: z.string().trim().max(1000).optional(),
    refuelled: z.boolean(),
    refuelPaidBy: z.enum(payerValues).nullable(),
    refuelAmount: z
      .number({ message: "Enter what the fuel cost as a number" })
      .positive("The fuel amount has to be more than zero")
      .max(MAX_REFUEL_AMOUNT, "That looks like a typo — check the amount")
      .nullable(),
  })
  .superRefine((v, ctx) => {
    // The follow-up questions are only asked when the answer was yes, so they're
    // only required when the answer was yes. Enforced here as well as hidden in
    // the form: an unasked question must not become a missing required field,
    // and an answered-then-unticked one must not survive.
    if (!v.refuelled) return;
    if (!v.refuelPaidBy) {
      ctx.addIssue({
        code: "custom",
        message: "Say whether you paid for the fuel yourself or used the company card",
        path: ["refuelPaidBy"],
      });
    }
    if (v.refuelAmount == null) {
      ctx.addIssue({
        code: "custom",
        message: "Enter the rand value of the fuel you bought",
        path: ["refuelAmount"],
      });
    }
  });

const extendSchema = z.object({
  bookingId: z.number().int().positive(),
  expectedReturnAt: dateTime,
});

function revalidate() {
  revalidatePath("/vehicle-bookings");
  revalidatePath("/vehicles");
}

/* ------------------------------------------------------------------ */
/* Is the vehicle free then?                                          */
/* ------------------------------------------------------------------ */

/**
 * The bookings standing in the way of a window.
 *
 * Deliberately a little wider than the database constraint: that one ranges
 * over the DECLARED window, while this treats a vehicle that is out and past
 * its expected return as occupied right up to now. Otherwise the moment a trip
 * ran late its slot would read as free, and the next person would be told to
 * come and collect a car that isn't there.
 */
async function conflictingBookings(vehicleId: number, from: Date, to: Date) {
  return db
    .select({
      id: vehicleBookings.id,
      bookedByUserId: vehicleBookings.bookedByUserId,
      bookedByName: vehicleBookings.bookedByName,
      bookedForUserId: vehicleBookings.bookedForUserId,
      bookedForName: vehicleBookings.bookedForName,
      takenOutAt: vehicleBookings.takenOutAt,
      expectedReturnAt: vehicleBookings.expectedReturnAt,
      status: vehicleBookings.status,
      overdue: sql<boolean>`${vehicleBookings.expectedReturnAt} < now()`,
    })
    .from(vehicleBookings)
    .where(
      and(
        eq(vehicleBookings.vehicleId, vehicleId),
        isNull(vehicleBookings.returnedAt),
        sql`tstzrange(${vehicleBookings.takenOutAt}, greatest(${vehicleBookings.expectedReturnAt}, now()), '[)')
            && tstzrange(${from}, ${to}, '[)')`,
      ),
    )
    .orderBy(asc(vehicleBookings.takenOutAt))
    .limit(1);
}

/** True when a write bounced off the no-overlap exclusion constraint. */
function isOverlapViolation(err: unknown): boolean {
  return err instanceof Error && /vehicle_bookings_no_overlap/.test(err.message);
}

function describeConflict(
  clash: {
    id: number;
    bookedByUserId: number | null;
    bookedByName: string;
    bookedForUserId: number | null;
    bookedForName: string | null;
    takenOutAt: Date;
    expectedReturnAt: Date;
    overdue: boolean;
  },
  vehicleName: string,
  askerId: number,
): VehicleConflict {
  return {
    bookingId: clash.id,
    vehicleName,
    holderName: clash.bookedForName ?? clash.bookedByName,
    fromLabel: formatDateTime(clash.takenOutAt),
    toLabel: formatDateTime(clash.expectedReturnAt),
    overdue: clash.overdue,
    isMine: clash.bookedByUserId === askerId || clash.bookedForUserId === askerId,
  };
}

/* ------------------------------------------------------------------ */
/* Telling both people                                                */
/* ------------------------------------------------------------------ */

/**
 * The booker and the driver, deduplicated by address.
 *
 * Carl's rule is that both are told, including when the booker booked it for
 * themselves — unlike the room-handover emails, where nobody is told about
 * their own edit. A vehicle going out is a thing worth a receipt even when you
 * arranged it yourself. Deduplicated because two names can share one address.
 */
function bothParties(booking: {
  bookedByName: string;
  bookedByEmail: string;
  bookedForName: string | null;
  bookedForEmail: string | null;
}): { email: string; name: string; isDriver: boolean }[] {
  const out = new Map<string, { email: string; name: string; isDriver: boolean }>();
  out.set(booking.bookedByEmail.toLowerCase(), {
    email: booking.bookedByEmail,
    name: booking.bookedByName,
    isDriver: !booking.bookedForEmail,
  });
  if (booking.bookedForEmail) {
    const key = booking.bookedForEmail.toLowerCase();
    // If the driver is also the booker, the existing entry already covers them —
    // but it's the driver's copy that should win, since it's the more specific
    // description of their part in it.
    out.set(key, {
      email: booking.bookedForEmail,
      name: booking.bookedForName ?? booking.bookedByName,
      isDriver: true,
    });
  }
  return [...out.values()];
}

/* ------------------------------------------------------------------ */
/* Signing a vehicle out                                              */
/* ------------------------------------------------------------------ */

export async function createVehicleBooking(
  _prev: VehicleBookingState,
  formData: FormData,
): Promise<VehicleBookingState> {
  // Booking a vehicle needs no more than hub access, exactly as booking a
  // meeting room doesn't — WHICH vehicle is the thing that's restricted.
  const user = await requirePermission("hub.view");

  const parsed = createSchema.safeParse({
    vehicleId: Number(formData.get("vehicleId") || 0),
    takenOutAt: String(formData.get("takenOutAt") ?? ""),
    expectedReturnAt: String(formData.get("expectedReturnAt") ?? ""),
    bookedForUserId: Number(formData.get("bookedForUserId") || 0),
    forService: formData.get("forService") === "yes",
    purpose: String(formData.get("purpose") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { vehicleId, takenOutAt, expectedReturnAt, bookedForUserId, forService, purpose } =
    parsed.data;

  // The company rule, checked against the database and not against whatever the
  // browser was given — a filtered dropdown is a convenience, not a control.
  const scope = await getBookerScope(user);
  const allowed = await assertCanBookVehicle(scope, vehicleId);
  if (!allowed.ok) return { error: allowed.error };
  const vehicle = allowed.vehicle;

  // Is it free then? Checked here so the refusal can name who has it and offer
  // to ask them for it; the exclusion constraint is what actually holds the
  // line when two people click Book in the same second.
  const [clash] = await conflictingBookings(vehicleId, takenOutAt, expectedReturnAt);
  if (clash) {
    return { conflict: describeConflict(clash, vehicle.name, user.id) };
  }

  // Booking on someone else's behalf. Resolved from the users table so the
  // snapshot is a real person, and picking yourself is simply "it's mine".
  let bookedFor: { id: number; name: string; email: string } | null = null;
  if (bookedForUserId > 0 && bookedForUserId !== user.id) {
    const [row] = await db
      .select({ id: users.id, name: users.name, email: users.email, active: users.active })
      .from(users)
      .where(eq(users.id, bookedForUserId))
      .limit(1);
    if (!row || !row.active) {
      return { error: "That person no longer has an active account — pick someone else." };
    }
    bookedFor = { id: row.id, name: row.name, email: row.email };
  }

  let row: { id: number };
  try {
    [row] = await db
      .insert(vehicleBookings)
      .values({
        vehicleId,
        bookedByUserId: user.id,
        bookedByName: user.name,
        bookedByEmail: user.email,
        bookedForUserId: bookedFor?.id ?? null,
        bookedForName: bookedFor?.name ?? null,
        bookedForEmail: bookedFor?.email ?? null,
        takenOutAt,
        expectedReturnAt,
        purpose: purpose ?? null,
        // Both mean "not here"; they're separate so the grid can answer "where
        // is it?" rather than only "is it available?".
        status: forService ? "servicing" : "out",
      })
      .returning({ id: vehicleBookings.id });
  } catch (err) {
    // Somebody booked the same window between the check above and this insert.
    if (!isOverlapViolation(err)) throw err;
    const [now] = await conflictingBookings(vehicleId, takenOutAt, expectedReturnAt);
    return now
      ? { conflict: describeConflict(now, vehicle.name, user.id) }
      : { error: `${vehicle.name} was booked for that window a moment ago. Try again.` };
  }

  await logEvent({
    action: "vehicle_booking.create",
    summary:
      `Took out ${vehicle.name} (${vehicle.regNumber})` +
      (bookedFor ? ` for ${bookedFor.name}` : "") +
      ` from ${formatDateTime(takenOutAt)}, due back ${formatDateTime(expectedReturnAt)}` +
      (forService ? " — going in for a service" : "") +
      (purpose ? ` — ${purpose}` : ""),
    actor: user,
    entityType: "vehicle_booking",
    entityId: row.id,
  });

  await sendBookedEmails({
    bookedByName: user.name,
    bookedByEmail: user.email,
    bookedForName: bookedFor?.name ?? null,
    bookedForEmail: bookedFor?.email ?? null,
    vehicleName: vehicle.name,
    vehicleReg: vehicle.regNumber,
    vehicleNickname: vehicle.nickname,
    takenOutAt,
    expectedReturnAt,
    forService,
    purpose: purpose ?? null,
  });

  revalidate();
  return { ok: true };
}

async function sendBookedEmails(booking: {
  bookedByName: string;
  bookedByEmail: string;
  bookedForName: string | null;
  bookedForEmail: string | null;
  vehicleName: string;
  vehicleReg: string;
  vehicleNickname: string | null;
  takenOutAt: Date;
  expectedReturnAt: Date;
  forService: boolean;
  purpose: string | null;
}) {
  // A booking that saved is a booking that happened. Mail is best-effort on top
  // of it, never a reason to fail the action after the row is committed.
  if (!mailConfigured()) return;

  const base = await appBaseUrl();
  const trip = {
    vehicleName: booking.vehicleName,
    vehicleReg: booking.vehicleReg,
    vehicleNickname: booking.vehicleNickname,
    driverName: booking.bookedForName ?? booking.bookedByName,
    bookedByName: booking.bookedByName,
    takenOnLabel: formatDateTime(booking.takenOutAt),
    expectedReturnLabel: formatDateTime(booking.expectedReturnAt),
    bookingsUrl: `${base}/vehicle-bookings`,
  };

  const parties = bothParties(booking);
  for (const party of parties) {
    const mail = vehicleBookedEmail({
      ...trip,
      name: party.name,
      audience: party.isDriver && booking.bookedForEmail != null ? "driver" : "booker",
      forService: booking.forService,
      purpose: booking.purpose,
    });
    await sendMail({ to: party.email, subject: mail.subject, html: mail.html, text: mail.text });
  }

  // Whoever the Notifications page says to copy — minus anyone above, so the
  // organiser who booked the vehicle themselves gets one email, not two.
  for (const extra of await extraRecipients("vehicle_booked", parties.map((p) => p.email))) {
    const mail = vehicleBookedEmail({
      ...trip,
      name: extra.name,
      audience: "observer",
      forService: booking.forService,
      purpose: booking.purpose,
    });
    await sendMail({ to: extra.email, subject: mail.subject, html: mail.html, text: mail.text });
  }
}

/* ------------------------------------------------------------------ */
/* Asking for a vehicle somebody else has                             */
/* ------------------------------------------------------------------ */

const stealSchema = z
  .object({
    bookingId: z.number().int().positive(),
    vehicleId: z.number().int().positive("Pick a vehicle"),
    takenOutAt: dateTime,
    expectedReturnAt: dateTime,
    bookedForUserId: z.number().int().nonnegative(),
    forService: z.boolean(),
    message: z
      .string()
      .trim()
      .min(5, "Say why you need it — that's what they'll be deciding on")
      .max(500),
  })
  .refine((v) => v.expectedReturnAt.getTime() > v.takenOutAt.getTime(), {
    message: "The expected return has to be after the time the vehicle is taken",
  });

/**
 * "Can I have it?" — sent to whoever holds the vehicle for that window.
 *
 * The window being asked for is stored on the request, not re-read from a form
 * at approval time: the holder is agreeing to a specific slot, and it has to be
 * the one they were shown.
 */
export async function requestVehicleSteal(
  _prev: VehicleBookingState,
  formData: FormData,
): Promise<VehicleBookingState> {
  const user = await requirePermission("hub.view");

  const parsed = stealSchema.safeParse({
    bookingId: Number(formData.get("bookingId") || 0),
    vehicleId: Number(formData.get("vehicleId") || 0),
    takenOutAt: String(formData.get("takenOutAt") ?? ""),
    expectedReturnAt: String(formData.get("expectedReturnAt") ?? ""),
    bookedForUserId: Number(formData.get("bookedForUserId") || 0),
    forService: formData.get("forService") === "yes",
    message: formData.get("message"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { bookingId, vehicleId, takenOutAt, expectedReturnAt, bookedForUserId, forService, message } =
    parsed.data;

  // Asking for a vehicle is still booking a vehicle: the same company rule
  // applies, re-read from the register.
  const scope = await getBookerScope(user);
  const allowed = await assertCanBookVehicle(scope, vehicleId);
  if (!allowed.ok) return { error: allowed.error };
  const vehicle = allowed.vehicle;

  const booking = await loadBooking(bookingId);
  if (!booking) return { error: "That booking no longer exists — try booking it again." };
  if (booking.vehicleId !== vehicleId) return { error: "That request doesn't match the vehicle." };
  if (booking.returnedAt) {
    return { error: `${vehicle.name} has since been brought back — try booking it again.` };
  }
  if (canReturnBooking(user, booking)) {
    return { error: "That's your own booking — you can extend it instead." };
  }

  // One live request per person per booking, so a keen asker can't fill the
  // holder's inbox.
  const [pending] = await db
    .select({ id: vehicleStealRequests.id })
    .from(vehicleStealRequests)
    .where(
      and(
        eq(vehicleStealRequests.bookingId, bookingId),
        eq(vehicleStealRequests.requesterUserId, user.id),
        eq(vehicleStealRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pending) return { error: "You've already asked for this one — waiting on their reply." };

  // Who it would be for, resolved now so approving doesn't have to.
  let bookedFor: { id: number; name: string; email: string } | null = null;
  if (bookedForUserId > 0 && bookedForUserId !== user.id) {
    const [found] = await db
      .select({ id: users.id, name: users.name, email: users.email, active: users.active })
      .from(users)
      .where(eq(users.id, bookedForUserId))
      .limit(1);
    if (!found || !found.active) {
      return { error: "That person no longer has an active account — pick someone else." };
    }
    bookedFor = { id: found.id, name: found.name, email: found.email };
  }

  const token = randomUUID();
  await db.insert(vehicleStealRequests).values({
    bookingId,
    requesterUserId: user.id,
    requesterName: user.name,
    requesterEmail: user.email,
    message,
    requestedFrom: takenOutAt,
    requestedTo: expectedReturnAt,
    requestedForUserId: bookedFor?.id ?? null,
    requestedForName: bookedFor?.name ?? null,
    requestedForEmail: bookedFor?.email ?? null,
    forService,
    token,
  });

  let delivered = false;
  if (mailConfigured()) {
    const base = await appBaseUrl();
    // Both the booker and the driver are asked; either can answer, whoever gets
    // to it first.
    for (const party of bothParties(booking)) {
      const mail = vehicleStealRequestEmail({
        holderName: party.name,
        requesterName: user.name,
        vehicleName: vehicle.name,
        vehicleReg: vehicle.regNumber,
        vehicleNickname: vehicle.nickname,
        message,
        yourFromLabel: formatDateTime(booking.takenOutAt),
        yourToLabel: formatDateTime(booking.expectedReturnAt),
        wantedFromLabel: formatDateTime(takenOutAt),
        wantedToLabel: formatDateTime(expectedReturnAt),
        approveUrl: `${base}/vehicle-bookings/request/${token}?action=approve`,
        declineUrl: `${base}/vehicle-bookings/request/${token}?action=decline`,
      });
      const res = await sendMail({
        to: party.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      if (res.ok) delivered = true;
    }
  }

  await logEvent({
    action: "vehicle_booking.steal_request",
    summary:
      `Asked ${booking.bookedForName ?? booking.bookedByName} for ${vehicle.name} ` +
      `(${vehicle.regNumber}) from ${formatDateTime(takenOutAt)} to ${formatDateTime(expectedReturnAt)}` +
      (delivered ? "" : " (email failed)"),
    actor: user,
    entityType: "vehicle_booking",
    entityId: bookingId,
  });

  revalidate();
  return {
    ok: true,
    warning: delivered
      ? undefined
      : "Your request was saved, but the email didn't send — tell them in person, they can still answer it in the app.",
  };
}

/**
 * The holder's answer.
 *
 * Approving does NOT transfer the booking the way a room steal does. A room
 * steal is always for exactly the same slot; a vehicle steal usually isn't —
 * the holder may have it all day while the asker only wants the afternoon. So
 * approving makes room and then books it:
 *
 *   - the holder's booking is shortened to end where the asker's begins, if it
 *     started earlier. They keep the first half, and if they've already got the
 *     vehicle the shortened deadline is what tells them to bring it back;
 *   - if the holder's booking begins at or after the asker's start it is
 *     entirely displaced, so it's deleted — it can only be a future
 *     reservation, because the asker's window can't start in the past.
 */
export async function respondToVehicleSteal(
  _prev: VehicleBookingState,
  formData: FormData,
): Promise<VehicleBookingState> {
  const user = await requirePermission("hub.view");
  const token = String(formData.get("token") ?? "");
  const decision = formData.get("decision") === "approve" ? "approve" : "decline";
  const reason = String(formData.get("reason") ?? "").trim();

  if (decision === "decline" && !reason) {
    return { error: "Please say why — they'll only see the reason you give." };
  }

  const [request] = await db
    .select()
    .from(vehicleStealRequests)
    .where(eq(vehicleStealRequests.token, token))
    .limit(1);
  if (!request) return { error: "That request no longer exists." };
  if (request.status !== "pending") return { error: "You've already answered this one." };

  const booking = await loadBooking(request.bookingId);
  if (!booking) return { error: "That booking no longer exists." };

  // The token names the request; it does not authorise it. Only the people
  // holding the vehicle — or whoever looks after the fleet — can answer.
  if (!canReturnBooking(user, booking)) {
    return { error: "Only the person who booked the vehicle can answer this." };
  }
  if (booking.returnedAt) {
    return {
      error: `${booking.vehicleName} has already been brought back, so there's nothing to hand over. Tell them to book it.`,
    };
  }

  const base = mailConfigured() ? await appBaseUrl() : null;

  if (decision === "decline") {
    await db
      .update(vehicleStealRequests)
      .set({ status: "declined", declineReason: reason, respondedAt: new Date() })
      .where(eq(vehicleStealRequests.id, request.id));

    if (base) {
      const mail = vehicleStealDeclinedEmail({
        requesterName: request.requesterName,
        holderName: booking.bookedForName ?? booking.bookedByName,
        vehicleName: booking.vehicleName,
        vehicleReg: booking.vehicleReg,
        wantedFromLabel: formatDateTime(request.requestedFrom),
        wantedToLabel: formatDateTime(request.requestedTo),
        reason,
        bookingsUrl: `${base}/vehicle-bookings`,
      });
      await sendMail({
        to: request.requesterEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
    }

    await logEvent({
      action: "vehicle_booking.steal_declined",
      summary: `Declined ${request.requesterName}'s request for ${booking.vehicleName} (${booking.vehicleReg})`,
      actor: user,
      entityType: "vehicle_booking",
      entityId: booking.id,
    });

    revalidate();
    revalidatePath(`/vehicle-bookings/request/${token}`);
    return { ok: true };
  }

  /* --- approved ------------------------------------------------------- */

  const keepsTheFirstPart = booking.takenOutAt.getTime() < request.requestedFrom.getTime();

  // Making room comes first. If the insert below fails there is no way to put
  // this back, so it is deliberately the reversible half that goes first: a
  // shortened booking is still a booking, and a deleted future reservation is
  // recorded in the activity log.
  if (keepsTheFirstPart) {
    await db
      .update(vehicleBookings)
      .set({
        expectedReturnAt: request.requestedFrom,
        // The deadline moved, so the old nudge no longer describes it.
        overdueRemindedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(vehicleBookings.id, booking.id));
  } else {
    await db.delete(vehicleBookings).where(eq(vehicleBookings.id, booking.id));
  }

  let created: { id: number };
  try {
    [created] = await db
      .insert(vehicleBookings)
      .values({
        vehicleId: booking.vehicleId,
        bookedByUserId: request.requesterUserId,
        bookedByName: request.requesterName,
        bookedByEmail: request.requesterEmail,
        bookedForUserId: request.requestedForUserId,
        bookedForName: request.requestedForName,
        bookedForEmail: request.requestedForEmail,
        takenOutAt: request.requestedFrom,
        expectedReturnAt: request.requestedTo,
        // The case they made for the vehicle IS why they're taking it, so it
        // carries straight through rather than being asked for a second time.
        purpose: request.message,
        status: request.forService ? "servicing" : "out",
      })
      .returning({ id: vehicleBookings.id });
  } catch (err) {
    if (!isOverlapViolation(err)) throw err;
    // Somebody else took the window while this request sat unanswered. The
    // holder's booking has already been shortened, which is the answer they
    // gave — so say what happened rather than pretending nothing did.
    return {
      error:
        `Your booking has been shortened as you agreed, but ${booking.vehicleName} is now booked by ` +
        `somebody else for that window, so ${request.requesterName} couldn't be given it. Tell them to book it again.`,
    };
  }

  await db
    .update(vehicleStealRequests)
    .set({ status: "approved", respondedAt: new Date() })
    .where(eq(vehicleStealRequests.id, request.id));

  // Any other outstanding asks were about a booking that has now changed shape,
  // so retire them rather than leave them answerable. (A deleted booking
  // cascades its requests away; a shortened one doesn't.)
  await db
    .update(vehicleStealRequests)
    .set({ status: "withdrawn", respondedAt: new Date() })
    .where(
      and(
        eq(vehicleStealRequests.bookingId, booking.id),
        eq(vehicleStealRequests.status, "pending"),
        ne(vehicleStealRequests.id, request.id),
      ),
    );

  if (base) {
    const mail = vehicleStealApprovedEmail({
      requesterName: request.requesterName,
      holderName: booking.bookedForName ?? booking.bookedByName,
      vehicleName: booking.vehicleName,
      vehicleReg: booking.vehicleReg,
      vehicleNickname: booking.vehicleNickname,
      wantedFromLabel: formatDateTime(request.requestedFrom),
      wantedToLabel: formatDateTime(request.requestedTo),
      bookingsUrl: `${base}/vehicle-bookings`,
    });
    await sendMail({
      to: request.requesterEmail,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  }

  await logEvent({
    action: "vehicle_booking.steal_approved",
    summary:
      `Gave ${request.requesterName} ${booking.vehicleName} (${booking.vehicleReg}) from ` +
      `${formatDateTime(request.requestedFrom)} to ${formatDateTime(request.requestedTo)} — ` +
      (keepsTheFirstPart
        ? `own booking shortened to end ${formatDateTime(request.requestedFrom)}`
        : "own booking given up entirely"),
    actor: user,
    entityType: "vehicle_booking",
    entityId: created.id,
  });

  revalidate();
  revalidatePath(`/vehicle-bookings/request/${token}`);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Extending an open booking                                          */
/* ------------------------------------------------------------------ */

/**
 * Pushes out the expected return time.
 *
 * The overdue email offers this as the alternative to signing the vehicle in,
 * so it has to exist for that advice to be honest. Clears
 * `overdueRemindedAt` — same discipline as clearing a reception slot's
 * reminder when it changes hands, so the new deadline gets its own nudge
 * rather than the pair silently losing one.
 */
export async function extendVehicleBooking(
  _prev: VehicleBookingState,
  formData: FormData,
): Promise<VehicleBookingState> {
  const user = await requirePermission("hub.view");

  const parsed = extendSchema.safeParse({
    bookingId: Number(formData.get("bookingId") || 0),
    expectedReturnAt: String(formData.get("expectedReturnAt") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { bookingId, expectedReturnAt } = parsed.data;

  const booking = await loadBooking(bookingId);
  if (!booking) return { error: "That booking no longer exists." };
  if (booking.status === "home") {
    return { error: `${booking.vehicleName} is already back — there's nothing to extend.` };
  }
  if (!canReturnBooking(user, booking)) {
    return {
      error: "Only the person who took the vehicle — or whoever looks after the fleet — can extend it.",
    };
  }
  if (expectedReturnAt.getTime() <= booking.takenOutAt.getTime()) {
    return { error: "The expected return has to be after the time the vehicle was taken." };
  }

  try {
    await db
      .update(vehicleBookings)
      .set({ expectedReturnAt, overdueRemindedAt: null, updatedAt: new Date() })
      .where(eq(vehicleBookings.id, bookingId));
  } catch (err) {
    // Extending into somebody else's booked window. Worth its own message —
    // "keep it longer" failing because of a constraint would otherwise read as
    // a bug rather than as somebody else being next in the queue.
    if (!isOverlapViolation(err)) throw err;
    const [next] = await conflictingBookings(booking.vehicleId, booking.expectedReturnAt, expectedReturnAt);
    return {
      error: next
        ? `${next.bookedForName ?? next.bookedByName} has ${booking.vehicleName} booked from ` +
          `${formatDateTime(next.takenOutAt)}, so it can't be kept until then. Bring it back, or ask them for it.`
        : `${booking.vehicleName} is booked by somebody else before then.`,
    };
  }

  await logEvent({
    action: "vehicle_booking.extend",
    summary:
      `Extended ${booking.vehicleName} (${booking.vehicleReg}) — due back ` +
      `${formatDateTime(expectedReturnAt)}, was ${formatDateTime(booking.expectedReturnAt)}`,
    actor: user,
    entityType: "vehicle_booking",
    entityId: bookingId,
  });

  revalidate();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Signing it back in                                                 */
/* ------------------------------------------------------------------ */

/**
 * The whole return, in one submit.
 *
 * Everything is recorded here rather than at sign-out: opening and closing
 * mileage, opening and closing fuel, notes, and whatever was spent on fuel.
 * That's deliberate — being made to read an odometer before you could drive
 * away was the part of the old flow the team disliked most.
 */
export async function returnVehicleBooking(
  _prev: VehicleBookingState,
  formData: FormData,
): Promise<VehicleBookingState> {
  const user = await requirePermission("hub.view");

  const refuelled = formData.get("refuelled") === "yes";
  const rawAmount = String(formData.get("refuelAmount") ?? "").trim();

  const parsed = returnSchema.safeParse({
    bookingId: Number(formData.get("bookingId") || 0),
    openingMileage: readMileage(formData.get("openingMileage")),
    closingMileage: readMileage(formData.get("closingMileage")),
    openingFuel: formData.get("openingFuel"),
    closingFuel: formData.get("closingFuel"),
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    refuelled,
    // Everything under the question is discarded when the answer is no, rather
    // than merely hidden — a "yes" filled in, then changed to "no", must not
    // leave a rand value on the record.
    refuelPaidBy: refuelled ? (formData.get("refuelPaidBy") || null) : null,
    refuelAmount: refuelled && rawAmount !== "" ? Number(rawAmount) : null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const {
    bookingId,
    openingMileage,
    closingMileage,
    openingFuel,
    closingFuel,
    notes,
    refuelPaidBy,
    refuelAmount,
  } = parsed.data;

  const booking = await loadBooking(bookingId);
  if (!booking) return { error: "That booking no longer exists." };
  if (booking.status === "home") {
    return { error: `${booking.vehicleName} has already been signed back in.` };
  }
  if (!canReturnBooking(user, booking)) {
    return {
      error: "Only the person who took the vehicle — or whoever looks after the fleet — can sign it back in.",
    };
  }

  // Whether the readings may be left out is the VEHICLE's setting, re-read from
  // the register — a form that doesn't mark the box required is a convenience,
  // exactly like the filtered dropdown on the way out.
  if (booking.vehicleMileageRequired && (openingMileage == null || closingMileage == null)) {
    return {
      error:
        `${booking.vehicleName} needs both its opening and closing mileage. Someone who looks after ` +
        `the fleet can switch this off for this vehicle if it genuinely has no reading.`,
    };
  }

  // The one check that has to be a refusal rather than a warning: an odometer
  // doesn't run backwards, so this is either a typo or the wrong vehicle, and
  // both make the distance meaningless.
  if (openingMileage != null && closingMileage != null && closingMileage < openingMileage) {
    return {
      error:
        `The closing mileage (${formatMileage(closingMileage)}) is less than the opening mileage ` +
        `(${formatMileage(openingMileage)}). Check the odometer.`,
    };
  }

  // Uploaded before the row is written, so a rejected photo doesn't come back
  // as an error on a trip that has already been closed off.
  const receipt = await storePrivatePhoto("vehicle-receipts", formData.get("refuelReceipt"), "receipt");
  if (!receipt.ok) return { error: receipt.error };

  const returnedAt = new Date();

  await db
    .update(vehicleBookings)
    .set({
      openingMileage,
      closingMileage,
      openingFuel,
      closingFuel,
      notes: notes ?? null,
      refuelled: parsed.data.refuelled,
      refuelPaidBy,
      // numeric wants a string; sending a float here is how cents go missing.
      refuelAmount: refuelAmount == null ? null : refuelAmount.toFixed(2),
      refuelReceiptPath: receipt.pathname,
      refuelReceiptContentType: receipt.contentType,
      status: "home",
      returnedAt,
      // The trip is over, so there is nothing left to be late for.
      overdueRemindedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(vehicleBookings.id, bookingId));

  const distance = mileageDifference(openingMileage, closingMileage);

  await logEvent({
    action: "vehicle_booking.return",
    summary:
      `Signed ${booking.vehicleName} (${booking.vehicleReg}) back in` +
      (distance == null
        ? " with no mileage recorded"
        : ` at ${formatMileage(closingMileage)} km — ${formatMileage(distance)} km travelled`) +
      `, tank ${fuelLabel(openingFuel).toLowerCase()} → ${fuelLabel(closingFuel).toLowerCase()}` +
      (parsed.data.refuelled
        ? `, ${formatRand(refuelAmount)} of fuel on ${refuelPayerLabel(refuelPaidBy).toLowerCase()}` +
          (receipt.pathname ? " with a receipt" : " with no receipt")
        : ""),
    actor: user,
    entityType: "vehicle_booking",
    entityId: bookingId,
  });

  await sendReturnedEmails(user, booking, {
    openingMileage,
    closingMileage,
    openingFuel,
    closingFuel,
    notes: notes ?? null,
    refuelled: parsed.data.refuelled,
    refuelPaidBy,
    refuelAmount,
    hasReceipt: receipt.pathname != null,
    returnedAt,
  });

  revalidate();
  return { ok: true };
}

async function sendReturnedEmails(
  actor: SessionUser,
  booking: Awaited<ReturnType<typeof loadBooking>> & object,
  filled: {
    openingMileage: number | null;
    closingMileage: number | null;
    openingFuel: FuelLevel;
    closingFuel: FuelLevel;
    notes: string | null;
    refuelled: boolean;
    refuelPaidBy: RefuelPayer | null;
    refuelAmount: number | null;
    hasReceipt: boolean;
    returnedAt: Date;
  },
) {
  if (!mailConfigured()) return;

  const base = await appBaseUrl();
  const distance = mileageDifference(filled.openingMileage, filled.closingMileage);
  const trip = {
    vehicleName: booking.vehicleName,
    vehicleReg: booking.vehicleReg,
    vehicleNickname: booking.vehicleNickname,
    driverName: booking.bookedForName ?? booking.bookedByName,
    bookedByName: booking.bookedByName,
    takenOnLabel: formatDateTime(booking.takenOutAt),
    expectedReturnLabel: formatDateTime(booking.expectedReturnAt),
    bookingsUrl: `${base}/vehicle-bookings`,
  };

  const parties = bothParties(booking);
  // The return email is already a third-person report of what was recorded, so
  // an observer's copy is word-for-word the same one.
  const audience = [
    ...parties,
    ...(await extraRecipients("vehicle_returned", parties.map((p) => p.email))),
  ];

  for (const party of audience) {
    const mail = vehicleReturnedEmail({
      ...trip,
      name: party.name,
      returnedLabel: formatDateTime(filled.returnedAt),
      openingMileageLabel:
        filled.openingMileage == null ? null : `${formatMileage(filled.openingMileage)} km`,
      closingMileageLabel:
        filled.closingMileage == null ? null : `${formatMileage(filled.closingMileage)} km`,
      distanceLabel: distance == null ? null : `${formatMileage(distance)} km`,
      openingFuelLabel: fuelLabel(filled.openingFuel),
      closingFuelLabel: fuelLabel(filled.closingFuel),
      notes: filled.notes,
      refuel: filled.refuelled
        ? {
            paidByLabel: refuelPayerLabel(filled.refuelPaidBy).toLowerCase(),
            amountLabel: formatRand(filled.refuelAmount),
            hasReceipt: filled.hasReceipt,
          }
        : null,
      signedInByName: actor.name,
    });
    await sendMail({ to: party.email, subject: mail.subject, html: mail.html, text: mail.text });
  }
}

/* ------------------------------------------------------------------ */
/* Escape hatch                                                       */
/* ------------------------------------------------------------------ */

/**
 * Deletes a booking made in error.
 *
 * Without it a wrong vehicle picked from the dropdown blocks that vehicle until
 * someone invents an odometer reading to "return" it. Restricted to the booker
 * and to whoever looks after the fleet, and refused once the vehicle has
 * actually been signed back in — at that point the row is a mileage record, not
 * a mistake.
 */
export async function cancelVehicleBooking(bookingId: number): Promise<VehicleBookingState> {
  const user = await requirePermission("hub.view");
  const booking = await loadBooking(bookingId);
  if (!booking) return { error: "That booking no longer exists." };

  const isBooker = booking.bookedByUserId === user.id;
  if (!isBooker && !hasPermission(user, "vehicles.manage")) {
    return { error: "Only the person who booked it, or whoever looks after the fleet, can undo this." };
  }
  if (booking.status === "home") {
    return { error: "That trip is finished — its mileage is part of the vehicle's history now." };
  }

  await db.delete(vehicleBookings).where(eq(vehicleBookings.id, bookingId));

  await logEvent({
    action: "vehicle_booking.cancel",
    summary:
      `Cancelled the booking of ${booking.vehicleName} (${booking.vehicleReg}) ` +
      `by ${booking.bookedByName} — booked in error, never signed back in`,
    actor: user,
    entityType: "vehicle_booking",
    entityId: bookingId,
  });

  // Told after the row is gone, and best-effort: a booking that was cancelled
  // was cancelled whether or not the mail goes out.
  if (mailConfigured()) {
    const base = await appBaseUrl();
    const trip = {
      vehicleName: booking.vehicleName,
      vehicleReg: booking.vehicleReg,
      vehicleNickname: booking.vehicleNickname,
      driverName: booking.bookedForName ?? booking.bookedByName,
      bookedByName: booking.bookedByName,
      takenOnLabel: formatDateTime(booking.takenOutAt),
      expectedReturnLabel: formatDateTime(booking.expectedReturnAt),
      bookingsUrl: `${base}/vehicle-bookings`,
    };
    const parties = bothParties(booking);
    const audience = [
      ...parties,
      ...(await extraRecipients("vehicle_cancelled", parties.map((p) => p.email))),
    ];
    for (const party of audience) {
      const mail = vehicleBookingCancelledEmail({
        ...trip,
        name: party.name,
        cancelledByName: user.name,
        // Either of the two can undo it, so the copy going to whoever pressed
        // the button reads as a receipt rather than as news.
        byYou: party.email.toLowerCase() === user.email.toLowerCase(),
        purpose: booking.purpose,
      });
      await sendMail({ to: party.email, subject: mail.subject, html: mail.html, text: mail.text });
    }
  }

  revalidate();
  return { ok: true };
}

/* ------------------------------------------------------------------ */

async function loadBooking(id: number) {
  const [row] = await db
    .select({
      id: vehicleBookings.id,
      vehicleId: vehicleBookings.vehicleId,
      vehicleName: vehicles.name,
      vehicleNickname: vehicles.nickname,
      vehicleReg: vehicles.regNumber,
      // Read off the vehicle, not off the booking: unticking the box should
      // release the trips already open, not only the ones started afterwards.
      vehicleMileageRequired: vehicles.mileageRequired,
      bookedByUserId: vehicleBookings.bookedByUserId,
      bookedByName: vehicleBookings.bookedByName,
      bookedByEmail: vehicleBookings.bookedByEmail,
      bookedForUserId: vehicleBookings.bookedForUserId,
      bookedForName: vehicleBookings.bookedForName,
      bookedForEmail: vehicleBookings.bookedForEmail,
      takenOutAt: vehicleBookings.takenOutAt,
      expectedReturnAt: vehicleBookings.expectedReturnAt,
      returnedAt: vehicleBookings.returnedAt,
      purpose: vehicleBookings.purpose,
      status: vehicleBookings.status,
    })
    .from(vehicleBookings)
    .innerJoin(vehicles, eq(vehicleBookings.vehicleId, vehicles.id))
    .where(eq(vehicleBookings.id, id))
    .limit(1);
  return row ?? null;
}
// NB: every export in a "use server" file becomes a POST endpoint of its own.
// Read-only helpers (the last odometer reading, for instance) therefore live in
// the page query, not here — an unguarded export is an unguarded route.
