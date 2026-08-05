import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, vehicleBookings, vehicles } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page";
import { VehiclesClient } from "./vehicles-client";

export const metadata = { title: "Vehicles — COLAB" };

export default async function VehiclesPage() {
  await requirePermission("vehicles.manage");

  const rows = await db
    .select({
      id: vehicles.id,
      name: vehicles.name,
      nickname: vehicles.nickname,
      vin: vehicles.vin,
      regNumber: vehicles.regNumber,
      colour: vehicles.colour,
      branded: vehicles.branded,
      companyId: vehicles.companyId,
      companyName: companies.name,
      mileageRequired: vehicles.mileageRequired,
      active: vehicles.active,
      // Drives the delete button's warning: with the number to hand it can say
      // what will actually happen instead of "this might not work".
      bookingCount: sql<number>`(
        select count(*)::int from ${vehicleBookings}
         where ${vehicleBookings.vehicleId} = ${vehicles.id}
      )`,
    })
    .from(vehicles)
    .innerJoin(companies, eq(vehicles.companyId, companies.id))
    .orderBy(asc(vehicles.name));

  // Only the sub-companies own vehicles — COLAB itself bills the shared costs,
  // it doesn't run a car.
  const subCompanies = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.type, "sub"))
    .orderBy(asc(companies.name));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Vehicles"
        description="The shared fleet. Add a vehicle here and it can be booked once the vehicle booking calendar is built."
      />
      <VehiclesClient vehicles={rows} subCompanies={subCompanies} />
    </div>
  );
}
