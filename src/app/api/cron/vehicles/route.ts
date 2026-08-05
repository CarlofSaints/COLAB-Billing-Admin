import { runVehicleOverdueReminders } from "@/lib/vehicle-reminders";
import { logEvent } from "@/lib/log";

/**
 * The overdue-vehicle nudge.
 *
 * Its own schedule, separate from the daily dispatcher and from the reception
 * rota: expected return times are typed by hand and can be any minute of any
 * day, so unlike reception this genuinely has to poll. Every 15 minutes (see
 * vercel.json); most ticks find nothing and return in milliseconds.
 */
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return req.headers.get("authorization") === `Bearer ${secret}`;
  }
  // Without a secret configured, only accept Vercel's own cron invocations.
  // Note the shape: this is an else, not an `if (secret && ...)` — a missing
  // secret must narrow what's accepted, never open the route to anyone.
  return req.headers.get("x-vercel-cron") != null;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const result = await runVehicleOverdueReminders();

  // Only a real send is logged. At 96 ticks a day, logging the quiet ones would
  // bury every other event in the activity log.
  if (result.sent > 0) {
    await logEvent({
      action: "vehicle_booking.overdue_reminders_sent",
      summary:
        `Sent ${result.sent} overdue-vehicle reminder(s) across ${result.bookings} booking(s)`,
      entityType: "vehicle_booking",
      actorType: "system",
    });
  }

  return Response.json(result);
}
