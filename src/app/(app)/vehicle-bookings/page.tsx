import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, users, vehicleBookings, vehicles } from "@/db/schema";
import { getCurrentUser, hasPermission, requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { bookableVehicles, getBookerScope } from "@/lib/vehicle-access";
import { isOverdue, overdueLabel } from "@/lib/vehicle-bookings";
import { VehicleBookingsClient } from "./vehicle-bookings-client";

export const metadata = { title: "Vehicle Bookings — COLAB" };

export default async function VehicleBookingsPage() {
  // Booking a vehicle needs no more than hub access, exactly as booking a room
  // doesn't. WHICH vehicle is what's restricted — see lib/vehicle-access.ts.
  const user = await requirePermission("hub.view");
  const sessionUser = (await getCurrentUser())!;

  const scope = await getBookerScope(sessionUser);
  const canBook = await bookableVehicles(scope);

  const bookingRows = await db
    .select({
      id: vehicleBookings.id,
      vehicleId: vehicleBookings.vehicleId,
      vehicleName: vehicles.name,
      vehicleNickname: vehicles.nickname,
      vehicleReg: vehicles.regNumber,
      vehicleCompanyName: companies.name,
      // Off the vehicle, so unticking the box releases trips that are already
      // open rather than only the ones started afterwards.
      vehicleMileageRequired: vehicles.mileageRequired,
      bookedByUserId: vehicleBookings.bookedByUserId,
      bookedByName: vehicleBookings.bookedByName,
      bookedForUserId: vehicleBookings.bookedForUserId,
      bookedForName: vehicleBookings.bookedForName,
      openingMileage: vehicleBookings.openingMileage,
      closingMileage: vehicleBookings.closingMileage,
      openingFuel: vehicleBookings.openingFuel,
      closingFuel: vehicleBookings.closingFuel,
      status: vehicleBookings.status,
      notes: vehicleBookings.notes,
      takenOutAt: vehicleBookings.takenOutAt,
      expectedReturnAt: vehicleBookings.expectedReturnAt,
      returnedAt: vehicleBookings.returnedAt,
      refuelled: vehicleBookings.refuelled,
      refuelPaidBy: vehicleBookings.refuelPaidBy,
      refuelAmount: vehicleBookings.refuelAmount,
      // The path itself never reaches the browser — the receipt is fetched from
      // /api/vehicle-receipt/[id], which re-checks who's asking. All the grid
      // needs to know is whether there is one.
      hasReceipt: sql<boolean>`${vehicleBookings.refuelReceiptPath} is not null`,
    })
    .from(vehicleBookings)
    .innerJoin(vehicles, eq(vehicleBookings.vehicleId, vehicles.id))
    .innerJoin(companies, eq(vehicles.companyId, companies.id))
    // Open trips first — "who has what right now" is the question the page is
    // opened to answer; history is what you scroll to. Within those, the most
    // overdue first, since that's the row someone needs to act on.
    .orderBy(
      sql`case when ${vehicleBookings.status} = 'home' then 1 else 0 end`,
      asc(vehicleBookings.expectedReturnAt),
      desc(vehicleBookings.takenOutAt),
    );

  const canManageFleet = hasPermission(sessionUser, "vehicles.manage");

  // Whether a trip is late is worked out here, on the server, rather than from
  // a clock in the browser. The page is server-rendered on every request, so
  // it's current when it loads — and a value derived from `new Date()` during a
  // client render disagrees with the server pass and trips a hydration
  // mismatch. The cron is what chases anyone who leaves the page open.
  const now = new Date();

  const bookings = bookingRows.map((b) => {
    const mine = b.bookedByUserId === sessionUser.id || b.bookedForUserId === sessionUser.id;
    const late = isOverdue({ status: b.status, expectedReturnAt: b.expectedReturnAt }, now);
    return {
      ...b,
      takenOutAt: b.takenOutAt.toISOString(),
      expectedReturnAt: b.expectedReturnAt.toISOString(),
      returnedAt: b.returnedAt?.toISOString() ?? null,
      overdue: late,
      /** "3 hours ago" — worded here so the grid never does date maths. */
      overdueFor: late ? overdueLabel(b.expectedReturnAt, now) : null,
      /** Who may fill in the return, and who may push the deadline out. */
      canReturn: b.status !== "home" && (mine || canManageFleet),
      canCancel: b.status !== "home" && (b.bookedByUserId === sessionUser.id || canManageFleet),
      /** Same set as canReturn — the receipt route enforces this server-side. */
      canSeeReceipt: mine || canManageFleet,
    };
  });

  // Which vehicles are currently unavailable, so the form can grey them out
  // rather than accept the booking and then refuse it.
  const openTrips = new Set(
    bookingRows.filter((b) => b.status !== "home").map((b) => b.vehicleId),
  );

  // Last recorded odometer reading per vehicle. No longer prefills anything at
  // sign-out — nothing is asked at sign-out any more — but it's what the return
  // form shows as a sanity check against the opening reading being typed in.
  const lastReadings = await db
    .select({
      vehicleId: vehicleBookings.vehicleId,
      closingMileage: sql<number>`max(${vehicleBookings.closingMileage})`,
    })
    .from(vehicleBookings)
    .where(eq(vehicleBookings.status, "home"))
    .groupBy(vehicleBookings.vehicleId);
  const lastMileage = new Map(lastReadings.map((r) => [r.vehicleId, r.closingMileage]));

  const fleet = canBook.map((v) => ({
    id: v.id,
    name: v.name,
    nickname: v.nickname,
    regNumber: v.regNumber,
    companyName: v.companyName,
    mileageRequired: v.mileageRequired,
    lastMileage: lastMileage.get(v.id) ?? null,
    available: !openTrips.has(v.id),
  }));

  // "Booking for someone else" has to be a login, not a team member: that
  // person becomes a holder, and a holder is someone who can sign the vehicle
  // back in and who gets told it was booked for them.
  const bookableUsers = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(asc(users.name));

  return (
    <div>
      <PageHeader
        title="Vehicle Bookings"
        description="Sign a vehicle out with the times you're taking it. The mileage, the fuel and anything you spent are filled in when you bring it back."
      />
      <VehicleBookingsClient
        bookings={bookings}
        fleet={fleet}
        allUsers={bookableUsers}
        currentUserId={sessionUser.id}
        currentUserEmail={user.email}
        scope={{
          companyName: scope.companyName,
          extraCompanyNames: scope.extraCompanyNames,
          reason: scope.reason,
        }}
      />
    </div>
  );
}
