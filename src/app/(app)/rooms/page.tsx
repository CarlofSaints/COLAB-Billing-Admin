import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { roomBookings, rooms } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { RoomsClient } from "./rooms-client";

export const metadata = { title: "Meeting Rooms — COLAB" };

export default async function RoomsPage() {
  await requirePermission("rooms.manage");

  const rows = await db.select().from(rooms).orderBy(asc(rooms.name));

  // How much each room is actually used, so retiring one isn't a blind call.
  const counts = await db
    .select({ roomId: roomBookings.roomId, count: sql<number>`count(*)::int` })
    .from(roomBookings)
    .where(eq(roomBookings.status, "confirmed"))
    .groupBy(roomBookings.roomId);
  const countMap = new Map(counts.map((c) => [c.roomId, c.count]));

  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    capacity: r.capacity,
    color: r.color,
    notes: r.notes ?? "",
    active: r.active,
    bookingCount: countMap.get(r.id) ?? 0,
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Meeting Rooms"
        description="The rooms people can book. Each room's colour is how its bookings appear on the calendar."
      />
      <RoomsClient rooms={data} />
    </div>
  );
}
