import { eq } from "drizzle-orm";
import { db } from "@/db";
import { roomBookings, rooms, roomStealRequests } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { longDateLabel, slotLabel } from "@/lib/bookings";
import { HandHelping } from "lucide-react";
import { StealResponseClient } from "./response-client";

export const metadata = { title: "Steal This Room — COLAB" };

/**
 * Where the Approve / Decline links in the request email land.
 *
 * The token identifies the request; it does not authenticate. Whoever follows
 * the link still has to be signed in, and still has to be the person holding
 * the room — otherwise anyone forwarded the email could give away someone
 * else's slot.
 */
export default async function StealRequestPage({
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
    .from(roomStealRequests)
    .where(eq(roomStealRequests.token, token))
    .limit(1);

  if (!request) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Steal This Room" />
        <EmptyState
          icon={<HandHelping className="h-8 w-8" />}
          title="That request no longer exists"
          description="It may have been withdrawn, or the booking was cancelled."
        />
      </div>
    );
  }

  const [booking] = await db
    .select()
    .from(roomBookings)
    .where(eq(roomBookings.id, request.bookingId))
    .limit(1);
  const [room] = booking
    ? await db.select().from(rooms).where(eq(rooms.id, booking.roomId)).limit(1)
    : [];

  // A booking made on someone's behalf has two holders, and either may answer.
  const isHolder =
    booking?.bookedByUserId === user?.id || booking?.bookedForUserId === user?.id;
  const canAnswer = isHolder || (user ? hasPermission(user, "bookings.manage") : false);
  const holderLabel = booking?.bookedForName
    ? `${booking.bookedForName} or ${booking.bookedByName}`
    : (booking?.bookedByName ?? "");

  if (!booking || booking.status !== "confirmed") {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Steal This Room" />
        <EmptyState
          icon={<HandHelping className="h-8 w-8" />}
          title="That booking is no longer live"
          description="It has been cancelled, so there's nothing to hand over."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="They want to steal your room"
        description="Nothing has changed yet. The room is still yours unless you approve this."
      />
      <Card className="p-4">
        <StealResponseClient
          token={token}
          status={request.status}
          canAnswer={canAnswer}
          declineReason={request.declineReason}
          initialAction={action === "decline" ? "decline" : action === "approve" ? "approve" : null}
          detail={{
            requesterName: request.requesterName,
            requesterMeeting: request.title,
            message: request.message,
            attendeeCount: request.attendeeCount,
            clientName: request.clientName,
            roomName: room?.name ?? "the room",
            dateLabel: longDateLabel(booking.date),
            timeLabel: slotLabel(booking.startMinute, booking.endMinute),
            yourMeeting: booking.title,
            holderName: holderLabel,
          }}
        />
      </Card>
    </div>
  );
}
