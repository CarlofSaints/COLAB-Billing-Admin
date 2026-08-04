"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, vehicleBookings, vehicles } from "@/db/schema";
import { hasPermission, requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { mailConfigured, sendMail, vehicleReturnOtpEmail } from "@/lib/mailer";
import {
  assertCanBookVehicle,
  canReturnBooking,
  getBookerScope,
} from "@/lib/vehicle-access";
import {
  FUEL_LEVELS,
  MAX_MILEAGE,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  OTP_TTL_MINUTES,
  formatMileage,
  fuelLabel,
  type FuelLevel,
} from "@/lib/vehicle-bookings";

export type VehicleBookingState = {
  error?: string;
  ok?: boolean;
  /** Set when the sign-in code has just gone out, so the form can ask for it. */
  otpSent?: boolean;
  /** Where the code went, so the person knows which inbox to open. */
  otpSentTo?: string;
};

const fuelValues = FUEL_LEVELS.map((f) => f.value) as [FuelLevel, ...FuelLevel[]];

const mileage = z
  .number({ message: "Enter the mileage as a number" })
  .int("Mileage is a whole number of kilometres")
  .min(0, "Mileage can't be negative")
  .max(MAX_MILEAGE, "That mileage looks like a typo — check the odometer");

const createSchema = z.object({
  vehicleId: z.number().int().positive("Pick a vehicle"),
  openingMileage: mileage,
  openingFuel: z.enum(fuelValues, { message: "Say how full the tank is" }),
  bookedForUserId: z.number().int().nonnegative(),
  forService: z.boolean(),
  notes: z.string().trim().max(500).optional(),
});

const returnSchema = z.object({
  bookingId: z.number().int().positive(),
  closingMileage: mileage,
  closingFuel: z.enum(fuelValues, { message: "Say how full the tank is" }),
});

/* ------------------------------------------------------------------ */
/* One-time code                                                      */
/* ------------------------------------------------------------------ */

/**
 * Salted with AUTH_SECRET and bound to the booking, so a hash lifted from one
 * row can't be replayed against another and a database read yields no usable
 * codes at all.
 */
function hashOtp(bookingId: number, code: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return createHash("sha256").update(`${secret}:${bookingId}:${code}`).digest("hex");
}

/** Digits only, so "418 302" and "418302" are the same answer. */
function normaliseCode(raw: string): string {
  return raw.replace(/\D/g, "");
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function codesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Clears every trace of an in-flight sign-in attempt. */
const CLEARED_OTP = {
  pendingClosingMileage: null,
  pendingClosingFuel: null,
  returnOtpHash: null,
  returnOtpExpiresAt: null,
  returnOtpSentAt: null,
  returnOtpAttempts: 0,
  returnOtpUserId: null,
} as const;

function revalidate() {
  revalidatePath("/vehicle-bookings");
  revalidatePath("/vehicles");
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
    openingMileage: Number(formData.get("openingMileage")),
    openingFuel: formData.get("openingFuel"),
    bookedForUserId: Number(formData.get("bookedForUserId") || 0),
    forService: formData.get("forService") === "yes",
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { vehicleId, openingMileage, openingFuel, bookedForUserId, forService, notes } =
    parsed.data;

  // The company rule, checked against the database and not against whatever the
  // browser was given — a filtered dropdown is a convenience, not a control.
  const scope = await getBookerScope(user);
  const allowed = await assertCanBookVehicle(scope, vehicleId);
  if (!allowed.ok) return { error: allowed.error };
  const vehicle = allowed.vehicle;

  // A vehicle can only be in one place. Checked here so the message can say who
  // has it; the partial unique index is what actually holds the line when two
  // people click Book at the same moment.
  const [openBooking] = await db
    .select({
      id: vehicleBookings.id,
      bookedByName: vehicleBookings.bookedByName,
      bookedForName: vehicleBookings.bookedForName,
      status: vehicleBookings.status,
    })
    .from(vehicleBookings)
    .where(and(eq(vehicleBookings.vehicleId, vehicleId), ne(vehicleBookings.status, "home")))
    .limit(1);

  if (openBooking) {
    const holder = openBooking.bookedForName ?? openBooking.bookedByName;
    return {
      error:
        openBooking.status === "servicing"
          ? `${vehicle.name} is at the workshop — it has to be signed back in first.`
          : `${holder} still has ${vehicle.name}. It has to be signed back in before it can go out again.`,
    };
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

  const [row] = await db
    .insert(vehicleBookings)
    .values({
      vehicleId,
      bookedByUserId: user.id,
      bookedByName: user.name,
      bookedByEmail: user.email,
      bookedForUserId: bookedFor?.id ?? null,
      bookedForName: bookedFor?.name ?? null,
      bookedForEmail: bookedFor?.email ?? null,
      openingMileage,
      openingFuel,
      // Both mean "not here"; they're separate so the grid can answer "where is
      // it?" rather than only "is it available?".
      status: forService ? "servicing" : "out",
      notes: notes ?? null,
    })
    .returning({ id: vehicleBookings.id });

  await logEvent({
    action: "vehicle_booking.create",
    summary:
      `Took out ${vehicle.name} (${vehicle.regNumber})` +
      (bookedFor ? ` for ${bookedFor.name}` : "") +
      ` at ${formatMileage(openingMileage)} km, tank ${fuelLabel(openingFuel).toLowerCase()}` +
      (forService ? " — going in for a service" : ""),
    actor: user,
    entityType: "vehicle_booking",
    entityId: row.id,
  });

  revalidate();
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Signing it back in — step 1, send the code                         */
/* ------------------------------------------------------------------ */

/**
 * Validates the closing readings, parks them on the row, and emails a code.
 *
 * The readings are stored now rather than posted again with the code, so that
 * the code approves the numbers that were on screen when it was asked for — and
 * so that refreshing the page mid-return doesn't lose them.
 */
export async function requestVehicleReturnOtp(
  _prev: VehicleBookingState,
  formData: FormData,
): Promise<VehicleBookingState> {
  const user = await requirePermission("hub.view");

  const parsed = returnSchema.safeParse({
    bookingId: Number(formData.get("bookingId") || 0),
    closingMileage: Number(formData.get("closingMileage")),
    closingFuel: formData.get("closingFuel"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { bookingId, closingMileage, closingFuel } = parsed.data;

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

  // The one check that has to be a refusal rather than a warning: an odometer
  // doesn't run backwards, so this is either a typo or the wrong vehicle, and
  // both make the distance meaningless.
  if (closingMileage < booking.openingMileage) {
    return {
      error:
        `The closing mileage (${formatMileage(closingMileage)}) is less than the opening mileage ` +
        `(${formatMileage(booking.openingMileage)}). Check the odometer.`,
    };
  }

  if (!mailConfigured()) {
    return {
      error:
        "Email isn't configured, so a sign-in code can't be sent. Ask an admin to sort this out before signing the vehicle in.",
    };
  }

  // Stops a stuck button turning into a mail flood, and makes the "Resend"
  // link honest about why nothing happened.
  if (booking.returnOtpSentAt && booking.returnOtpUserId === user.id) {
    const secondsSince = (Date.now() - booking.returnOtpSentAt.getTime()) / 1000;
    if (secondsSince < OTP_RESEND_SECONDS) {
      return {
        error: `A code was just sent to ${user.email}. Wait ${Math.ceil(OTP_RESEND_SECONDS - secondsSince)} seconds before asking for another.`,
      };
    }
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await db
    .update(vehicleBookings)
    .set({
      pendingClosingMileage: closingMileage,
      pendingClosingFuel: closingFuel,
      returnOtpHash: hashOtp(bookingId, code),
      returnOtpExpiresAt: expiresAt,
      returnOtpSentAt: new Date(),
      returnOtpAttempts: 0,
      // Bound to the person who asked, so a code can't be requested by one
      // person and spent by another.
      returnOtpUserId: user.id,
      updatedAt: new Date(),
    })
    .where(eq(vehicleBookings.id, bookingId));

  const distance = closingMileage - booking.openingMileage;
  const mail = vehicleReturnOtpEmail({
    name: user.name,
    // Grouped for reading off a phone; the check strips everything but digits.
    code: `${code.slice(0, 3)} ${code.slice(3)}`,
    vehicleName: booking.vehicleName,
    vehicleReg: booking.vehicleReg,
    closingMileage,
    closingFuelLabel: fuelLabel(closingFuel),
    distanceLabel: `${formatMileage(distance)} km`,
    minutesValid: OTP_TTL_MINUTES,
  });

  const sent = await sendMail({
    to: user.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  if (!sent.ok) {
    // Don't leave a live code against a booking whose owner never received it.
    await db
      .update(vehicleBookings)
      .set({ ...CLEARED_OTP, updatedAt: new Date() })
      .where(eq(vehicleBookings.id, bookingId));
    return { error: `The sign-in code couldn't be emailed: ${sent.error}` };
  }

  await logEvent({
    action: "vehicle_booking.otp_sent",
    summary: `Sent a sign-in code for ${booking.vehicleName} (${booking.vehicleReg}) to ${user.email}`,
    actor: user,
    entityType: "vehicle_booking",
    entityId: bookingId,
  });

  revalidate();
  return { ok: true, otpSent: true, otpSentTo: user.email };
}

/* ------------------------------------------------------------------ */
/* Signing it back in — step 2, spend the code                        */
/* ------------------------------------------------------------------ */

export async function confirmVehicleReturn(
  _prev: VehicleBookingState,
  formData: FormData,
): Promise<VehicleBookingState> {
  const user = await requirePermission("hub.view");
  const bookingId = Number(formData.get("bookingId") || 0);
  const code = normaliseCode(String(formData.get("code") ?? ""));
  if (!bookingId) return { error: "Missing booking." };
  if (!code) return { error: "Enter the code from your email." };

  const booking = await loadBooking(bookingId);
  if (!booking) return { error: "That booking no longer exists." };
  if (booking.status === "home") {
    return { error: `${booking.vehicleName} has already been signed back in.` };
  }
  if (!canReturnBooking(user, booking)) {
    return { error: "Only the person who took the vehicle can sign it back in." };
  }
  if (!booking.returnOtpHash || booking.pendingClosingMileage == null || !booking.pendingClosingFuel) {
    return { error: "There's no code waiting. Fill in the return details and ask for a new one." };
  }
  if (booking.returnOtpUserId !== user.id) {
    return { error: "That code was sent to somebody else. Ask for your own." };
  }
  if (!booking.returnOtpExpiresAt || booking.returnOtpExpiresAt.getTime() < Date.now()) {
    await db
      .update(vehicleBookings)
      .set({ ...CLEARED_OTP, updatedAt: new Date() })
      .where(eq(vehicleBookings.id, bookingId));
    return { error: "That code has expired. Ask for a new one." };
  }
  if (booking.returnOtpAttempts >= OTP_MAX_ATTEMPTS) {
    await db
      .update(vehicleBookings)
      .set({ ...CLEARED_OTP, updatedAt: new Date() })
      .where(eq(vehicleBookings.id, bookingId));
    return { error: "Too many wrong codes. Ask for a new one." };
  }

  if (!codesMatch(hashOtp(bookingId, code), booking.returnOtpHash)) {
    const attempts = booking.returnOtpAttempts + 1;
    await db
      .update(vehicleBookings)
      .set({ returnOtpAttempts: attempts, updatedAt: new Date() })
      .where(eq(vehicleBookings.id, bookingId));
    const left = OTP_MAX_ATTEMPTS - attempts;
    return {
      error:
        left > 0
          ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`
          : "That code isn't right, and that was the last try. Ask for a new one.",
    };
  }

  const closingMileage = booking.pendingClosingMileage;
  const closingFuel = booking.pendingClosingFuel;
  const distance = closingMileage - booking.openingMileage;

  await db
    .update(vehicleBookings)
    .set({
      closingMileage,
      closingFuel,
      status: "home",
      returnedAt: new Date(),
      ...CLEARED_OTP,
      updatedAt: new Date(),
    })
    .where(eq(vehicleBookings.id, bookingId));

  await logEvent({
    action: "vehicle_booking.return",
    summary:
      `Signed ${booking.vehicleName} (${booking.vehicleReg}) back in at ` +
      `${formatMileage(closingMileage)} km — ${formatMileage(distance)} km travelled, ` +
      `tank ${fuelLabel(closingFuel).toLowerCase()}`,
    actor: user,
    entityType: "vehicle_booking",
    entityId: bookingId,
  });

  revalidate();
  return { ok: true };
}

/** Abandons a half-finished sign-in — closing the form shouldn't leave a live code. */
export async function cancelVehicleReturn(bookingId: number) {
  const user = await requirePermission("hub.view");
  const booking = await loadBooking(bookingId);
  if (!booking || !canReturnBooking(user, booking)) return;
  if (booking.returnOtpUserId !== user.id) return;

  await db
    .update(vehicleBookings)
    .set({ ...CLEARED_OTP, updatedAt: new Date() })
    .where(eq(vehicleBookings.id, bookingId));
  revalidate();
}

/* ------------------------------------------------------------------ */
/* Escape hatch                                                       */
/* ------------------------------------------------------------------ */

/**
 * Deletes a booking made in error.
 *
 * Not part of the brief, but without it a wrong vehicle picked from the
 * dropdown blocks that vehicle until someone invents an odometer reading to
 * "return" it. Restricted to the booker and to whoever looks after the fleet,
 * and refused once the vehicle has actually been signed back in — at that point
 * the row is a mileage record, not a mistake.
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
      vehicleReg: vehicles.regNumber,
      bookedByUserId: vehicleBookings.bookedByUserId,
      bookedByName: vehicleBookings.bookedByName,
      bookedForUserId: vehicleBookings.bookedForUserId,
      openingMileage: vehicleBookings.openingMileage,
      status: vehicleBookings.status,
      pendingClosingMileage: vehicleBookings.pendingClosingMileage,
      pendingClosingFuel: vehicleBookings.pendingClosingFuel,
      returnOtpHash: vehicleBookings.returnOtpHash,
      returnOtpExpiresAt: vehicleBookings.returnOtpExpiresAt,
      returnOtpSentAt: vehicleBookings.returnOtpSentAt,
      returnOtpAttempts: vehicleBookings.returnOtpAttempts,
      returnOtpUserId: vehicleBookings.returnOtpUserId,
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
