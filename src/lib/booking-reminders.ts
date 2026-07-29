import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { roomBookingAttendees, roomBookings, rooms, users } from "@/db/schema";
import { appBaseUrl, bookingReminderEmail, mailConfigured, sendMail } from "@/lib/mailer";
import { longDateLabel, slotLabel } from "@/lib/bookings";
import { sastDateKey } from "@/lib/schedules";

/**
 * Emails whoever booked a room the day before their meeting.
 *
 * Shares the daily 06:00 SAST mail cron. "Tomorrow" is worked out in SAST, and
 * `reminderSentAt` gates the send, so running the cron twice in a day can't
 * send twice.
 */
export async function runBookingReminders(): Promise<{ checked: number; sent: number }> {
  if (!mailConfigured()) return { checked: 0, sent: 0 };

  const tomorrow = sastDateKey(new Date(Date.now() + 24 * 3_600_000));

  const rows = await db
    .select({
      id: roomBookings.id,
      title: roomBookings.title,
      date: roomBookings.date,
      startMinute: roomBookings.startMinute,
      endMinute: roomBookings.endMinute,
      bookedByName: roomBookings.bookedByName,
      bookedByEmail: roomBookings.bookedByEmail,
      bookedForName: roomBookings.bookedForName,
      bookedForEmail: roomBookings.bookedForEmail,
      clientName: roomBookings.clientName,
      attendeeCount: roomBookings.attendeeCount,
      recurrenceLabel: roomBookings.recurrenceLabel,
      roomName: rooms.name,
    })
    .from(roomBookings)
    .innerJoin(rooms, eq(roomBookings.roomId, rooms.id))
    .where(
      and(
        eq(roomBookings.date, tomorrow),
        eq(roomBookings.status, "confirmed"),
        isNull(roomBookings.reminderSentAt),
      ),
    );

  if (rows.length === 0) return { checked: 0, sent: 0 };

  const base = await appBaseUrl();
  const bookingsUrl = `${base}/bookings`;
  let sent = 0;

  for (const b of rows) {
    if (!b.bookedByEmail) continue;

    const attendees = await db
      .select({ name: users.name })
      .from(roomBookingAttendees)
      .innerJoin(users, eq(roomBookingAttendees.userId, users.id))
      .where(eq(roomBookingAttendees.bookingId, b.id));

    // Whoever booked it and, when it was booked on someone's behalf, whoever
    // it's for — both need the nudge, not just the one who clicked.
    const recipients = [{ email: b.bookedByEmail, name: b.bookedByName }];
    if (b.bookedForEmail && b.bookedForEmail !== b.bookedByEmail) {
      recipients.push({ email: b.bookedForEmail, name: b.bookedForName ?? b.bookedForEmail });
    }

    let anyDelivered = false;
    for (const to of recipients) {
      const mail = bookingReminderEmail({
        bookerName: to.name,
        roomName: b.roomName,
        title: b.title,
        dateLabel: longDateLabel(b.date),
        timeLabel: slotLabel(b.startMinute, b.endMinute),
        attendeeCount: b.attendeeCount,
        clientName: b.clientName,
        attendees: attendees.map((a) => a.name),
        recurrenceLabel: b.recurrenceLabel,
        bookedForName: b.bookedForName,
        bookedByName: b.bookedByName,
        bookingsUrl,
      });
      const res = await sendMail({
        to: to.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      if (res.ok) anyDelivered = true;
    }

    // Marked as reminded if either landed — retrying tomorrow would be a
    // reminder for a meeting that has already happened.
    if (anyDelivered) {
      await db
        .update(roomBookings)
        .set({ reminderSentAt: new Date() })
        .where(eq(roomBookings.id, b.id));
      sent++;
    }
  }

  return { checked: rows.length, sent };
}
