import "server-only";
import { and, asc, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, vehicleBookings, vehicles } from "@/db/schema";
import { appBaseUrl, mailConfigured, sendMail, vehicleOverdueEmail } from "@/lib/mailer";
import { notificationRecipients } from "@/lib/notifications";
import { formatDateTime, overdueLabel } from "@/lib/vehicle-bookings";

/**
 * "That vehicle was due back and it isn't" — emailed to whoever booked it and,
 * when they're different people, to whoever is driving it.
 *
 * Cadence is Carl's: one email the moment it goes overdue, then one a day while
 * the vehicle is still out. `overdue_reminded_at` is what enforces that — the
 * cron ticks every 15 minutes, so without it a late vehicle would email its
 * driver ninety-six times a day.
 *
 * Correctness deliberately does NOT depend on a tick landing near the expected
 * return time. Expected returns are typed by hand and can be any minute of any
 * day, so this is a sweep of everything already overdue rather than a schedule
 * shaped to the data (unlike the reception nudge, whose slots sit on a grid).
 * A missed tick therefore delays a reminder; it never loses one.
 */

/** One a day, once it's late. */
const REMIND_EVERY_MS = 24 * 60 * 60 * 1000;

export type VehicleReminderResult = {
  overdue: number;
  sent: number;
  bookings: number;
};

export async function runVehicleOverdueReminders(
  now: Date = new Date(),
): Promise<VehicleReminderResult> {
  if (!mailConfigured()) return { overdue: 0, sent: 0, bookings: 0 };

  const dueBefore = new Date(now.getTime() - REMIND_EVERY_MS);

  const rows = await db
    .select({
      id: vehicleBookings.id,
      vehicleName: vehicles.name,
      vehicleNickname: vehicles.nickname,
      vehicleReg: vehicles.regNumber,
      companyName: companies.name,
      bookedByName: vehicleBookings.bookedByName,
      bookedByEmail: vehicleBookings.bookedByEmail,
      bookedForName: vehicleBookings.bookedForName,
      bookedForEmail: vehicleBookings.bookedForEmail,
      takenOutAt: vehicleBookings.takenOutAt,
      expectedReturnAt: vehicleBookings.expectedReturnAt,
      overdueRemindedAt: vehicleBookings.overdueRemindedAt,
    })
    .from(vehicleBookings)
    .innerJoin(vehicles, eq(vehicleBookings.vehicleId, vehicles.id))
    .innerJoin(companies, eq(vehicles.companyId, companies.id))
    .where(
      and(
        // Both `out` and `servicing` mean the vehicle isn't back.
        ne(vehicleBookings.status, "home"),
        // A declined trip isn't happening, so nobody is late for it.
        isNull(vehicleBookings.declinedAt),
        lt(vehicleBookings.expectedReturnAt, now),
        // Never reminded, or last reminded more than a day ago.
        or(
          sql`${vehicleBookings.overdueRemindedAt} is null`,
          lt(vehicleBookings.overdueRemindedAt, dueBefore),
        ),
      ),
    )
    .orderBy(asc(vehicleBookings.expectedReturnAt));

  if (rows.length === 0) return { overdue: 0, sent: 0, bookings: 0 };

  const base = await appBaseUrl();
  const bookingsUrl = `${base}/vehicle-bookings`;
  let sent = 0;
  let bookings = 0;

  for (const row of rows) {
    const driverName = row.bookedForName ?? row.bookedByName;
    const trip = {
      vehicleName: row.vehicleName,
      vehicleReg: row.vehicleReg,
      vehicleNickname: row.vehicleNickname,
      driverName,
      bookedByName: row.bookedByName,
      takenOnLabel: formatDateTime(row.takenOutAt),
      expectedReturnLabel: formatDateTime(row.expectedReturnAt),
      bookingsUrl,
    };
    const late = overdueLabel(row.expectedReturnAt, now);

    // Both people, deduplicated by address — booking a vehicle for yourself
    // must not send you the same nudge twice, and the two names can differ
    // while the address is the same.
    const recipients = new Map<string, string>();
    recipients.set(row.bookedByEmail.toLowerCase(), row.bookedByName);
    if (row.bookedForEmail) {
      recipients.set(row.bookedForEmail.toLowerCase(), row.bookedForName ?? row.bookedByName);
    }

    let anySent = false;
    for (const [email, name] of recipients) {
      const mail = vehicleOverdueEmail({ ...trip, name, overdueLabel: late });
      const res = await sendMail({
        to: email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      if (res.ok) {
        sent += 1;
        anySent = true;
      }
    }

    // Whoever the Notifications page says to copy. Their version drops the
    // "sign it in or extend it" instruction — only the holder can do either.
    for (const extra of await notificationRecipients("vehicle_overdue", [...recipients.keys()])) {
      const mail = vehicleOverdueEmail({
        ...trip,
        name: extra.name,
        overdueLabel: late,
        forObserver: true,
      });
      const res = await sendMail({
        to: extra.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      if (res.ok) {
        sent += 1;
        anySent = true;
      }
    }

    // Stamped only when something actually went out. A failed send leaves the
    // row untouched, so the next tick tries again rather than marking the
    // booking as nudged and going quiet for a day.
    if (anySent) {
      bookings += 1;
      await db
        .update(vehicleBookings)
        .set({ overdueRemindedAt: now, updatedAt: new Date() })
        .where(eq(vehicleBookings.id, row.id));
    }
  }

  return { overdue: rows.length, sent, bookings };
}

/**
 * What the next tick would send, without sending it — the diagnostic twin of
 * the runner, in the shape `scripts/check-reception-reminders.ts` established.
 */
export async function previewVehicleOverdueReminders(now: Date = new Date()) {
  const dueBefore = new Date(now.getTime() - REMIND_EVERY_MS);
  return db
    .select({
      id: vehicleBookings.id,
      vehicleName: vehicles.name,
      vehicleReg: vehicles.regNumber,
      bookedByName: vehicleBookings.bookedByName,
      bookedByEmail: vehicleBookings.bookedByEmail,
      bookedForName: vehicleBookings.bookedForName,
      bookedForEmail: vehicleBookings.bookedForEmail,
      expectedReturnAt: vehicleBookings.expectedReturnAt,
      overdueRemindedAt: vehicleBookings.overdueRemindedAt,
      status: vehicleBookings.status,
    })
    .from(vehicleBookings)
    .innerJoin(vehicles, eq(vehicleBookings.vehicleId, vehicles.id))
    .where(
      and(
        ne(vehicleBookings.status, "home"),
        // Must match the runner exactly — a diagnostic that disagrees with the
        // thing it diagnoses is worse than no diagnostic.
        isNull(vehicleBookings.declinedAt),
        lt(vehicleBookings.expectedReturnAt, now),
        or(
          sql`${vehicleBookings.overdueRemindedAt} is null`,
          lt(vehicleBookings.overdueRemindedAt, dueBefore),
        ),
      ),
    )
    .orderBy(asc(vehicleBookings.expectedReturnAt));
}

/** Every open booking, overdue or not — context for the diagnostic script. */
export async function openVehicleBookings() {
  return db
    .select({
      id: vehicleBookings.id,
      vehicleName: vehicles.name,
      bookedByName: vehicleBookings.bookedByName,
      expectedReturnAt: vehicleBookings.expectedReturnAt,
      overdueRemindedAt: vehicleBookings.overdueRemindedAt,
      status: vehicleBookings.status,
    })
    .from(vehicleBookings)
    .innerJoin(vehicles, eq(vehicleBookings.vehicleId, vehicles.id))
    .where(
      and(
        ne(vehicleBookings.status, "home"),
        isNull(vehicleBookings.declinedAt),
        isNotNull(vehicleBookings.expectedReturnAt),
      ),
    )
    .orderBy(asc(vehicleBookings.expectedReturnAt));
}
