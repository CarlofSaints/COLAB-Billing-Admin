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

    const mail = bookingReminderEmail({
      bookerName: b.bookedByName,
      roomName: b.roomName,
      title: b.title,
      dateLabel: longDateLabel(b.date),
      timeLabel: slotLabel(b.startMinute, b.endMinute),
      attendeeCount: b.attendeeCount,
      clientName: b.clientName,
      attendees: attendees.map((a) => a.name),
      recurrenceLabel: b.recurrenceLabel,
      bookingsUrl,
    });

    const res = await sendMail({
      to: b.bookedByEmail,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (res.ok) {
      await db
        .update(roomBookings)
        .set({ reminderSentAt: new Date() })
        .where(eq(roomBookings.id, b.id));
      sent++;
    }
  }

  return { checked: rows.length, sent };
}
