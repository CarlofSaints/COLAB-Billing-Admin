import { eq } from "drizzle-orm";
import { Car } from "lucide-react";
import { db } from "@/db";
import { vehicleBookings, vehicleStealRequests, vehicles } from "@/db/schema";
import { requirePermission, getCurrentUser } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { canReturnBooking } from "@/lib/vehicle-access";
import { formatDateTime } from "@/lib/vehicle-bookings";
import { VehicleStealResponseClient } from "./response-client";

export const metadata = { title: "Vehicle request — COLAB" };

/**
 * Where the Approve / Decline links in the request email land.
 *
 * The token identifies the request; it does not authenticate. Whoever follows
 * the link still has to be signed in, and still has to be holding the vehicle —
 * otherwise anyone forwarded the email could give away somebody else's booking.
 */
export default async function VehicleStealRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  await requirePermission("hub.view");
  const user = await getCurrentUser();
  const { token } = await params;
  const { action } = await searchParams;

  const [request] = await db
    .select()
    .from(vehicleStealRequests)
    .where(eq(vehicleStealRequests.token, token))
    .limit(1);

  if (!request) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Vehicle request" />
        <EmptyState
          icon={<Car className="h-8 w-8" />}
          title="That request no longer exists"
          description="It may have been withdrawn, or the booking was removed."
        />
      </div>
    );
  }

  const [booking] = await db
    .select({
      id: vehicleBookings.id,
      bookedByUserId: vehicleBookings.bookedByUserId,
      bookedByName: vehicleBookings.bookedByName,
      bookedForUserId: vehicleBookings.bookedForUserId,
      bookedForName: vehicleBookings.bookedForName,
      takenOutAt: vehicleBookings.takenOutAt,
      expectedReturnAt: vehicleBookings.expectedReturnAt,
      returnedAt: vehicleBookings.returnedAt,
      vehicleName: vehicles.name,
      vehicleNickname: vehicles.nickname,
      vehicleReg: vehicles.regNumber,
    })
    .from(vehicleBookings)
    .innerJoin(vehicles, eq(vehicleBookings.vehicleId, vehicles.id))
    .where(eq(vehicleBookings.id, request.bookingId))
    .limit(1);

  if (!booking) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Vehicle request" />
        <EmptyState
          icon={<Car className="h-8 w-8" />}
          title="That booking no longer exists"
          description="It has been removed, so there's nothing to hand over."
        />
      </div>
    );
  }

  if (booking.returnedAt) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Vehicle request" />
        <EmptyState
          icon={<Car className="h-8 w-8" />}
          title={`${booking.vehicleName} is already back`}
          description={`The trip finished on ${formatDateTime(booking.returnedAt)}, so there's nothing to hand over — ${request.requesterName} can simply book it.`}
        />
      </div>
    );
  }

  // A booking made on someone's behalf has two holders, and either may answer.
  const canAnswer = user ? canReturnBooking(user, booking) : false;
  const holderLabel = booking.bookedForName
    ? `${booking.bookedForName} or ${booking.bookedByName}`
    : booking.bookedByName;

  // What approving would actually do to their own booking — spelled out,
  // because "shortened" and "given up" are very different answers and the
  // difference is not obvious from the two windows alone.
  const keepsTheFirstPart =
    booking.takenOutAt.getTime() < request.requestedFrom.getTime();

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="They're asking for your vehicle"
        description="Nothing has changed yet. The booking is still yours unless you approve this."
      />
      <Card className="p-4">
        <VehicleStealResponseClient
          token={token}
          status={request.status}
          canAnswer={canAnswer}
          declineReason={request.declineReason}
          initialAction={action === "decline" ? "decline" : action === "approve" ? "approve" : null}
          detail={{
            requesterName: request.requesterName,
            message: request.message,
            vehicleLabel: `${booking.vehicleName}${booking.vehicleNickname ? ` “${booking.vehicleNickname}”` : ""} (${booking.vehicleReg})`,
            yourFromLabel: formatDateTime(booking.takenOutAt),
            yourToLabel: formatDateTime(booking.expectedReturnAt),
            wantedFromLabel: formatDateTime(request.requestedFrom),
            wantedToLabel: formatDateTime(request.requestedTo),
            holderName: holderLabel,
            keepsTheFirstPart,
            shortenedToLabel: formatDateTime(request.requestedFrom),
          }}
        />
      </Card>
    </div>
  );
}
