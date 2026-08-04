import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, users, vehicleBookings, vehicles } from "@/db/schema";
import { getCurrentUser, hasPermission, requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { bookableVehicles, getBookerScope } from "@/lib/vehicle-access";
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
      returnedAt: vehicleBookings.returnedAt,
      // Enough to tell the browser "you have a code waiting on this row", and
      // deliberately not the hash or the code itself.
      otpUserId: vehicleBookings.returnOtpUserId,
      // Evaluated by Postgres rather than compared against Date.now() here:
      // a render has to be pure, and the database's clock is the same one the
      // action will check the code against.
      otpLive: sql<boolean>`${vehicleBookings.returnOtpExpiresAt} > now()`,
      pendingClosingMileage: vehicleBookings.pendingClosingMileage,
      pendingClosingFuel: vehicleBookings.pendingClosingFuel,
    })
    .from(vehicleBookings)
    .innerJoin(vehicles, eq(vehicleBookings.vehicleId, vehicles.id))
    .innerJoin(companies, eq(vehicles.companyId, companies.id))
    // Open trips first — "who has what right now" is the question the page is
    // opened to answer; history is what you scroll to.
    .orderBy(
      sql`case when ${vehicleBookings.status} = 'home' then 1 else 0 end`,
      desc(vehicleBookings.takenOutAt),
    );

  const canManageFleet = hasPermission(sessionUser, "vehicles.manage");

  const bookings = bookingRows.map(({ otpUserId, otpLive, ...b }) => {
    const mine = b.bookedByUserId === sessionUser.id || b.bookedForUserId === sessionUser.id;
    return {
      ...b,
      takenOutAt: b.takenOutAt.toISOString(),
      returnedAt: b.returnedAt?.toISOString() ?? null,
      /** Who may open the return form. The code is what proves they're them. */
      canReturn: b.status !== "home" && (mine || canManageFleet),
      canCancel: b.status !== "home" && (b.bookedByUserId === sessionUser.id || canManageFleet),
      /**
       * A code already sent to *this* user and still in date, so a refresh
       * lands back on the "enter the code" step instead of silently starting
       * over and emailing a second one.
       */
      hasLiveOtp: otpUserId === sessionUser.id && otpLive === true,
    };
  });

  // Last recorded odometer reading per vehicle, so the next trip's opening
  // mileage starts from the truth instead of an empty box. Computed here rather
  // than exported from the actions file — every export in a "use server" module
  // is a POST endpoint, and this one would be an unguarded read.
  const lastReadings = await db
    .select({
      vehicleId: vehicleBookings.vehicleId,
      closingMileage: sql<number>`max(${vehicleBookings.closingMileage})`,
    })
    .from(vehicleBookings)
    .where(eq(vehicleBookings.status, "home"))
    .groupBy(vehicleBookings.vehicleId);
  const lastMileage = new Map(lastReadings.map((r) => [r.vehicleId, r.closingMileage]));

  // Which vehicles are currently unavailable, so the form can grey them out
  // rather than accept the booking and then refuse it.
  const openTrips = new Set(
    bookingRows.filter((b) => b.status !== "home").map((b) => b.vehicleId),
  );

  const fleet = canBook.map((v) => ({
    id: v.id,
    name: v.name,
    nickname: v.nickname,
    regNumber: v.regNumber,
    companyName: v.companyName,
    lastMileage: lastMileage.get(v.id) ?? null,
    available: !openTrips.has(v.id),
  }));

  // "Booking for someone else" has to be a login, not a team member: that
  // person becomes a holder, and a holder is someone who can sign the vehicle
  // back in with a code sent to their own address.
  const bookableUsers = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(asc(users.name));

  return (
    <div>
      <PageHeader
        title="Vehicle Bookings"
        description="Sign a vehicle out, and sign it back in when you return it. Click a row to fill in the return."
      />
      <VehicleBookingsClient
        bookings={bookings}
        fleet={fleet}
        allUsers={bookableUsers}
        currentUserId={sessionUser.id}
        currentUserEmail={user.email}
        scope={{
          companyName: scope.companyName,
          canBookAnyCompany: scope.canBookAnyCompany,
          reason: scope.reason,
        }}
      />
    </div>
  );
}
