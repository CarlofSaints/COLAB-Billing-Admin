"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, vehicleBookings, vehicles } from "@/db/schema";
import { hasPermission, requirePermission, type SessionUser } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import {
  appBaseUrl,
  mailConfigured,
  sendMail,
  vehicleBookedEmail,
  vehicleReturnedEmail,
} from "@/lib/mailer";
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

export type VehicleBookingState = { error?: string; ok?: boolean };

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
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { vehicleId, takenOutAt, expectedReturnAt, bookedForUserId, forService } = parsed.data;

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
      takenOutAt,
      expectedReturnAt,
      // Both mean "not here"; they're separate so the grid can answer "where is
      // it?" rather than only "is it available?".
      status: forService ? "servicing" : "out",
    })
    .returning({ id: vehicleBookings.id });

  await logEvent({
    action: "vehicle_booking.create",
    summary:
      `Took out ${vehicle.name} (${vehicle.regNumber})` +
      (bookedFor ? ` for ${bookedFor.name}` : "") +
      ` from ${formatDateTime(takenOutAt)}, due back ${formatDateTime(expectedReturnAt)}` +
      (forService ? " — going in for a service" : ""),
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

  for (const party of bothParties(booking)) {
    const mail = vehicleBookedEmail({
      ...trip,
      name: party.name,
      forDriver: party.isDriver && booking.bookedForEmail != null,
      forService: booking.forService,
    });
    await sendMail({ to: party.email, subject: mail.subject, html: mail.html, text: mail.text });
  }
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

  await db
    .update(vehicleBookings)
    .set({ expectedReturnAt, overdueRemindedAt: null, updatedAt: new Date() })
    .where(eq(vehicleBookings.id, bookingId));

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

  for (const party of bothParties(booking)) {
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
