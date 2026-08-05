import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { vehicleBookings } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { canReturnBooking } from "@/lib/vehicle-access";

/**
 * Serves the fuel receipt attached to a vehicle return, from the PRIVATE Blob
 * store.
 *
 * Narrower than `/api/issue-photo/[id]`, which any signed-in user may read: the
 * bookings grid is visible to everyone with hub access, but a till slip can
 * carry a card number and an address. So this is limited to the same people who
 * could fill the return in — the booker, whoever it was booked for, and whoever
 * looks after the fleet.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) return new Response("Bad request", { status: 400 });

  const [row] = await db
    .select({
      path: vehicleBookings.refuelReceiptPath,
      contentType: vehicleBookings.refuelReceiptContentType,
      bookedByUserId: vehicleBookings.bookedByUserId,
      bookedForUserId: vehicleBookings.bookedForUserId,
    })
    .from(vehicleBookings)
    .where(eq(vehicleBookings.id, bookingId))
    .limit(1);
  if (!row?.path) return new Response("Not found", { status: 404 });

  // Same rule as opening the return form. Deliberately reusing that function
  // rather than restating it: two copies of "who is entitled to this booking"
  // is how the read side ends up more generous than the write side.
  if (!canReturnBooking(user, row) && !hasPermission(user, "vehicles.manage")) {
    return new Response("Forbidden", { status: 403 });
  }

  const res = await get(row.path, { access: "private" });
  if (!res || res.statusCode !== 200) return new Response("Not found", { status: 404 });

  return new Response(res.stream, {
    headers: {
      "Content-Type": row.contentType || res.blob.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    },
  });
}
