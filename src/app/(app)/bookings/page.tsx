import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { roomBookingAttendees, roomBookings, rooms, roomStealRequests, users } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { addDays, weekDays, weekStart } from "@/lib/bookings";
import { sastDateKey } from "@/lib/schedules";
import { BookingsClient } from "./bookings-client";
import { DoorOpen } from "lucide-react";

export const metadata = { title: "Room Bookings — COLAB" };

// The week and room come from the query string, so a link to a particular
// week is shareable and the back button behaves.
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; week?: string }>;
}) {
  await requirePermission("hub.view");
  const user = await getCurrentUser();
  const params = await searchParams;

  const roomRows = await db
    .select()
    .from(rooms)
    .where(eq(rooms.active, true))
    .orderBy(asc(rooms.name));

  if (roomRows.length === 0) {
    return (
      <div>
        <PageHeader title="Room Bookings" description="Book a meeting room." />
        <EmptyState
          icon={<DoorOpen className="h-8 w-8" />}
          title="No rooms have been set up yet"
          description="Once an admin adds meeting rooms on the Meeting Rooms page, they'll be bookable here."
        />
      </div>
    );
  }

  const selectedRoomId =
    roomRows.find((r) => r.id === Number(params.room))?.id ?? roomRows[0].id;
  const monday = params.week && /^\d{4}-\d{2}-\d{2}$/.test(params.week)
    ? weekStart(params.week)
    : weekStart(sastDateKey(new Date()));
  const days = weekDays(monday);

  const bookingRows = await db
    .select({
      id: roomBookings.id,
      title: roomBookings.title,
      date: roomBookings.date,
      startMinute: roomBookings.startMinute,
      endMinute: roomBookings.endMinute,
      bookedByUserId: roomBookings.bookedByUserId,
      bookedByName: roomBookings.bookedByName,
      bookedForUserId: roomBookings.bookedForUserId,
      bookedForName: roomBookings.bookedForName,
      clientName: roomBookings.clientName,
      attendeeCount: roomBookings.attendeeCount,
      seriesId: roomBookings.seriesId,
      recurrenceLabel: roomBookings.recurrenceLabel,
    })
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.roomId, selectedRoomId),
        eq(roomBookings.status, "confirmed"),
        gte(roomBookings.date, monday),
        lte(roomBookings.date, addDays(monday, 6)),
      ),
    )
    .orderBy(asc(roomBookings.date), asc(roomBookings.startMinute));

  const ids = bookingRows.map((b) => b.id);

  // Attendee names, and which slots already have someone asking for them —
  // both so the calendar can show the full picture without a second click.
  const attendeeRows = ids.length
    ? await db
        .select({ bookingId: roomBookingAttendees.bookingId, name: users.name })
        .from(roomBookingAttendees)
        .innerJoin(users, eq(roomBookingAttendees.userId, users.id))
        .where(inArray(roomBookingAttendees.bookingId, ids))
    : [];

  const pendingRows = ids.length
    ? await db
        .select({
          bookingId: roomStealRequests.bookingId,
          requesterUserId: roomStealRequests.requesterUserId,
          requesterName: roomStealRequests.requesterName,
        })
        .from(roomStealRequests)
        .where(
          and(
            eq(roomStealRequests.status, "pending"),
            inArray(roomStealRequests.bookingId, ids),
          ),
        )
    : [];

  const bookings = bookingRows.map((b) => ({
    ...b,
    attendees: attendeeRows.filter((a) => a.bookingId === b.id).map((a) => a.name),
    pendingRequests: pendingRows.filter((p) => p.bookingId === b.id).length,
    iAsked: pendingRows.some((p) => p.bookingId === b.id && p.requesterUserId === user?.id),
    // Both holders count as "mine" — the person it was booked for shouldn't be
    // offered a button to ask themselves for their own room.
    isMine: b.bookedByUserId === user?.id || b.bookedForUserId === user?.id,
  }));

  const bookableUsers = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(asc(users.name));

  return (
    <div>
      <PageHeader
        title="Room Bookings"
        description="Pick a room, then click a slot to book it. If someone already has the slot you need, you can ask them for it."
      />
      <BookingsClient
        rooms={roomRows.map((r) => ({
          id: r.id,
          name: r.name,
          capacity: r.capacity,
          color: r.color,
          notes: r.notes ?? "",
        }))}
        selectedRoomId={selectedRoomId}
        monday={monday}
        days={days}
        today={sastDateKey(new Date())}
        bookings={bookings}
        allUsers={bookableUsers}
        currentUserId={user?.id ?? 0}
        canManageAny={user ? hasPermission(user, "bookings.manage") : false}
      />
    </div>
  );
}
