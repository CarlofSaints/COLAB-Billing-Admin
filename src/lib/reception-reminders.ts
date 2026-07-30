import "server-only";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { receptionSlots, staff } from "@/db/schema";
import { appBaseUrl, mailConfigured, receptionDutyReminderEmail, sendMail } from "@/lib/mailer";
import { dayLabel, minutesToLabel, selectDueShifts } from "@/lib/reception";
import { SAST_OFFSET_MINUTES, sastDateKey } from "@/lib/schedules";

/**
 * "You're on the front desk in 10 minutes" — emailed to whoever is next up on
 * the reception rota.
 *
 * The cron is scheduled to land on the reminder times rather than polling (see
 * `REMINDER_CRON_MINUTES`), but correctness deliberately does NOT depend on a
 * tick arriving at the exact minute:
 *
 *   - `selectDueShifts` asks "which shifts start round about now", so a tick a
 *     few minutes late still sends;
 *   - the email quotes the real gap at send time rather than a fixed 10;
 *   - `reminderSentAt` gates every send, so an extra tick can't nudge twice.
 *
 * Reception people mostly have no hub login, so this goes to the address on
 * their team-member record rather than to a user account.
 */

/** Today's SAST date and how far into that day we are, in minutes. */
function nowInSast(now: Date): { dateKey: string; minuteOfDay: number } {
  const shifted = new Date(now.getTime() + SAST_OFFSET_MINUTES * 60_000);
  return {
    dateKey: sastDateKey(now),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** One day of assigned slots, oldest first — what `selectDueShifts` expects. */
export async function loadDay(dateKey: string) {
  return db
    .select({
      id: receptionSlots.id,
      startMinute: receptionSlots.startMinute,
      endMinute: receptionSlots.endMinute,
      staffId: receptionSlots.staffId,
      reminderSentAt: receptionSlots.reminderSentAt,
      name: staff.name,
      email: staff.email,
    })
    .from(receptionSlots)
    .innerJoin(staff, eq(staff.id, receptionSlots.staffId))
    .where(and(eq(receptionSlots.date, dateKey), isNotNull(receptionSlots.staffId)))
    .orderBy(asc(receptionSlots.startMinute), asc(receptionSlots.id));
}

export async function runReceptionReminders(
  now: Date = new Date(),
): Promise<{ checked: number; sent: number; testTo: string | null }> {
  const testTo = process.env.RECEPTION_REMINDER_TEST_TO?.trim() || null;
  if (!mailConfigured()) return { checked: 0, sent: 0, testTo };

  const { dateKey, minuteOfDay } = nowInSast(now);

  // The whole day, not just the due slots — working out whether someone is
  // already at the desk needs the slot before, and merging a back-to-back run
  // needs the ones after.
  const day = await loadDay(dateKey);
  if (day.length === 0) return { checked: 0, sent: 0, testTo };

  const due = selectDueShifts(day, minuteOfDay);
  if (due.length === 0) return { checked: 0, sent: 0, testTo };

  const base = await appBaseUrl();
  const rotaUrl = `${base}/reception`;
  let sent = 0;

  for (const shift of due) {
    const ids = shift.slots.map((s) => s.id);
    const person = shift.slots[0];

    // Already standing there — the previous slot ran straight into this one and
    // it's the same person, so there is nothing to take over. Marked so it
    // isn't reconsidered at every tick inside the window.
    if (shift.alreadyOnDesk) {
      await markReminded(ids, now);
      continue;
    }

    // No address to send to. In test mode it still goes out, because "this
    // person has no email" is exactly the sort of thing the test should reveal.
    if (!person.email && !testTo) {
      await markReminded(ids, now);
      continue;
    }

    const mail = receptionDutyReminderEmail({
      name: person.name,
      dateLabel: dayLabel(dateKey),
      timeLabel: `${minutesToLabel(shift.startMinute)} – ${minutesToLabel(shift.endMinute)}`,
      minutesUntil: shift.minutesUntil,
      merged: shift.slots.length > 1,
      rotaUrl,
      testFor: testTo ? { name: person.name, email: person.email } : null,
    });

    const res = await sendMail({
      to: testTo ?? person.email!,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    if (res.ok) {
      await markReminded(ids, now);
      sent++;
    }
    // A failed send is left unmarked on purpose: the next tick is only minutes
    // away and still inside the window, so it gets one more chance.
  }

  return { checked: due.length, sent, testTo };
}

async function markReminded(ids: number[], at: Date) {
  await db.update(receptionSlots).set({ reminderSentAt: at }).where(inArray(receptionSlots.id, ids));
}
