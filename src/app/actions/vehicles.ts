"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { companies, vehicleBookings, vehicles } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";

export type VehicleState = { error?: string; ok?: boolean };

const vehicleSchema = z.object({
  name: z.string().trim().min(1, "Say what the vehicle is, e.g. Toyota Corolla 1.6").max(80),
  nickname: z.string().trim().max(40).optional(),
  // Kept loose on purpose: a VIN is 17 characters on anything modern, but the
  // older cars in the fleet predate that and the number is often read off a
  // licence disc. Rejecting a real vehicle's real VIN would be worse than
  // storing a short one.
  vin: z.string().trim().max(32).optional(),
  regNumber: z.string().trim().min(1, "A vehicle needs its registration number").max(20),
  colour: z.string().trim().max(30).optional(),
  branded: z.boolean(),
  companyId: z
    .number()
    .int()
    .positive("Say which sub-company the vehicle belongs to"),
  // Whether a booking of this vehicle has to carry odometer readings. On for
  // anything new; unticked for the vehicles nobody reads a reading off.
  mileageRequired: z.boolean(),
});

function parse(formData: FormData) {
  return vehicleSchema.safeParse({
    name: formData.get("name"),
    nickname: String(formData.get("nickname") ?? "").trim() || undefined,
    // Plates and VINs are written down in every casing under the sun; storing
    // one shape means the register reads consistently and the uniqueness check
    // can't be fooled by "ca 123-456" vs "CA 123-456".
    vin: String(formData.get("vin") ?? "").trim().toUpperCase() || undefined,
    regNumber: String(formData.get("regNumber") ?? "").trim().toUpperCase(),
    colour: String(formData.get("colour") ?? "").trim() || undefined,
    branded: formData.get("branded") === "yes",
    companyId: Number(formData.get("companyId") || 0),
    mileageRequired: formData.get("mileageRequired") === "yes",
  });
}

function revalidateVehiclePaths() {
  revalidatePath("/vehicles");
}

export async function saveVehicle(
  _prev: VehicleState,
  formData: FormData,
): Promise<VehicleState> {
  const actor = await requirePermission("vehicles.manage");
  const id = formData.get("id") ? Number(formData.get("id")) : null;

  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, nickname, vin, regNumber, colour, branded, companyId, mileageRequired } =
    parsed.data;

  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.type, "sub")))
    .limit(1);
  if (!company) return { error: "Pick which sub-company the vehicle belongs to." };

  // Checked here as well as by the unique index, so the message names which
  // field clashed and with what — a raw constraint error can't tell you that,
  // and "reg or VIN, one of them, somewhere" is not a useful thing to be told.
  const clash = await db
    .select({ id: vehicles.id, name: vehicles.name, regNumber: vehicles.regNumber, vin: vehicles.vin })
    .from(vehicles)
    .where(
      and(
        id ? ne(vehicles.id, id) : undefined,
        vin
          ? sql`(lower(${vehicles.regNumber}) = ${regNumber.toLowerCase()} or lower(${vehicles.vin}) = ${vin.toLowerCase()})`
          : sql`lower(${vehicles.regNumber}) = ${regNumber.toLowerCase()}`,
      ),
    )
    .limit(1);

  if (clash.length > 0) {
    const other = clash[0];
    const which =
      other.regNumber.toLowerCase() === regNumber.toLowerCase() ? "registration number" : "VIN";
    return { error: `${other.name} already has that ${which}.` };
  }

  const values = {
    name,
    nickname: nickname ?? null,
    vin: vin ?? null,
    regNumber,
    colour: colour ?? null,
    branded,
    companyId,
    mileageRequired,
  };

  if (id) {
    await db
      .update(vehicles)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(vehicles.id, id));
  } else {
    await db.insert(vehicles).values(values);
  }

  await logEvent({
    action: id ? "vehicle.update" : "vehicle.create",
    summary:
      `${id ? "Updated" : "Added"} vehicle "${name}"${nickname ? ` (${nickname})` : ""} ` +
      `${regNumber} — ${company.name}${branded ? ", branded" : ""}` +
      // Worth logging only when it's off: it's the state that changes what the
      // booking form asks for, and it's the one someone will later query.
      (mileageRequired ? "" : ", mileage readings not required"),
    actor,
    entityType: "vehicle",
    entityId: id ?? undefined,
  });

  revalidateVehiclePaths();
  return { ok: true };
}

/**
 * Vehicles leave the fleet by being deactivated, not deleted — the same call
 * rooms make. Once bookings hang off a vehicle, deleting one would take the
 * record of who had it and when along with it.
 */
export async function setVehicleActive(id: number, active: boolean) {
  const actor = await requirePermission("vehicles.manage");
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
  if (!vehicle) return;

  await db.update(vehicles).set({ active, updatedAt: new Date() }).where(eq(vehicles.id, id));

  await logEvent({
    action: active ? "vehicle.reactivate" : "vehicle.retire",
    summary: `${active ? "Brought back" : "Retired"} vehicle "${vehicle.name}" (${vehicle.regNumber})`,
    actor,
    entityType: "vehicle",
    entityId: id,
  });

  revalidateVehiclePaths();
}

/**
 * Removes a vehicle. Only really deletes if it has never been booked —
 * otherwise it's retired, so it disappears from the booking form without taking
 * its mileage history with it.
 *
 * The FK from `vehicle_bookings` is `restrict`, so a hard delete would throw a
 * constraint error rather than do damage; this exists so the person gets an
 * answer instead of a stack trace, and so the common case (a vehicle added by
 * mistake, never driven) actually goes away.
 */
export async function deleteVehicle(id: number): Promise<VehicleState> {
  const actor = await requirePermission("vehicles.manage");

  const [vehicle] = await db
    .select({ name: vehicles.name, regNumber: vehicles.regNumber, active: vehicles.active })
    .from(vehicles)
    .where(eq(vehicles.id, id))
    .limit(1);
  if (!vehicle) return { error: "That vehicle is no longer in the register." };

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vehicleBookings)
    .where(eq(vehicleBookings.vehicleId, id));

  if (count > 0) {
    // Already retired and still referenced: there is nothing further to do, and
    // saying "done" would imply the record had gone.
    if (!vehicle.active) {
      return {
        error: `${vehicle.name} has ${count} trip${count === 1 ? "" : "s"} on record, so it can't be deleted. It's already retired.`,
      };
    }
    await db.update(vehicles).set({ active: false, updatedAt: new Date() }).where(eq(vehicles.id, id));
    await logEvent({
      action: "vehicle.retire",
      summary: `Retired vehicle "${vehicle.name}" (${vehicle.regNumber}) — ${count} trip(s) on record, so not deleted`,
      actor,
      entityType: "vehicle",
      entityId: id,
    });
    revalidateVehiclePaths();
    return {
      ok: true,
      error: `${vehicle.name} has ${count} trip${count === 1 ? "" : "s"} on record, so it's been retired instead of deleted. The mileage history is kept.`,
    };
  }

  await db.delete(vehicles).where(eq(vehicles.id, id));
  await logEvent({
    action: "vehicle.delete",
    summary: `Deleted vehicle "${vehicle.name}" (${vehicle.regNumber}) — never booked`,
    actor,
    entityType: "vehicle",
    entityId: id,
  });
  revalidateVehiclePaths();
  return { ok: true };
}
