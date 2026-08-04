import "server-only";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, staff, vehicles } from "@/db/schema";
import { hasPermission, type SessionUser } from "@/lib/auth";

/**
 * Who may book what.
 *
 * The rule is Carl's: you book your own company's vehicles, unless a Director
 * has ticked "Can book vehicles from other companies" on your team member
 * record. Everything that decides that lives here, so the dropdown the browser
 * is given and the check the server makes on submit can't drift apart — a
 * filtered `<select>` is a courtesy, never a control.
 */
export type BookerScope = {
  /** Their team member record, if their login is linked to one at all. */
  staffId: number | null;
  companyId: number | null;
  companyName: string | null;
  /** May reach beyond `companyId`. */
  canBookAnyCompany: boolean;
  /** Why they can, for the wording on screen. */
  reason: "own_company" | "granted" | "super_admin" | "no_team_record";
};

/**
 * Resolves the signed-in user to a team member, and from there to a company.
 *
 * Matches on the `userId` FK first and falls back to the email address, because
 * across this app the link between a login and a team member is the EMAIL — the
 * FK exists but is only populated in some paths. Getting this backwards means a
 * real person is told they have no team record.
 */
export async function getBookerScope(user: SessionUser): Promise<BookerScope> {
  const rows = await db
    .select({
      id: staff.id,
      userId: staff.userId,
      companyId: staff.companyId,
      companyName: companies.name,
      canBookOtherCompanyVehicles: staff.canBookOtherCompanyVehicles,
      active: staff.active,
    })
    .from(staff)
    .innerJoin(companies, eq(staff.companyId, companies.id))
    .where(
      or(
        eq(staff.userId, user.id),
        sql`lower(${staff.email}) = ${user.email.toLowerCase()}`,
      ),
    );

  // Prefer the explicit link; the email match is the fallback, and an active
  // row beats a deactivated one if somehow both exist.
  const row =
    rows.find((r) => r.userId === user.id && r.active) ??
    rows.find((r) => r.userId === user.id) ??
    rows.find((r) => r.active) ??
    rows[0] ??
    null;

  // Super Admin bypasses this the way it bypasses every other check in the app
  // (see hasPermission) — otherwise the person who administers the fleet can
  // lock themselves out of it and have no way to tell why the list is empty.
  const isSuperAdmin = user.roleKey === "super_admin";

  if (!row) {
    return {
      staffId: null,
      companyId: null,
      companyName: null,
      canBookAnyCompany: isSuperAdmin,
      reason: isSuperAdmin ? "super_admin" : "no_team_record",
    };
  }

  return {
    staffId: row.id,
    companyId: row.companyId,
    companyName: row.companyName,
    canBookAnyCompany: row.canBookOtherCompanyVehicles || isSuperAdmin,
    reason: row.canBookOtherCompanyVehicles
      ? "granted"
      : isSuperAdmin
        ? "super_admin"
        : "own_company",
  };
}

/** The active vehicles this person is allowed to sign out. */
export async function bookableVehicles(scope: BookerScope) {
  const base = db
    .select({
      id: vehicles.id,
      name: vehicles.name,
      nickname: vehicles.nickname,
      regNumber: vehicles.regNumber,
      colour: vehicles.colour,
      companyId: vehicles.companyId,
      companyName: companies.name,
    })
    .from(vehicles)
    .innerJoin(companies, eq(vehicles.companyId, companies.id));

  if (scope.canBookAnyCompany) {
    return base.where(eq(vehicles.active, true)).orderBy(asc(vehicles.name));
  }
  // No company resolved and no grant means nothing is bookable. Expressed as an
  // impossible id rather than an unfiltered query, so a future refactor that
  // loses the null check fails closed.
  const allowed = scope.companyId == null ? [-1] : [scope.companyId];
  return base
    .where(and(eq(vehicles.active, true), inArray(vehicles.companyId, allowed)))
    .orderBy(asc(vehicles.name));
}

/**
 * The authorization check on submit. Re-reads the vehicle rather than trusting
 * anything the form said about it.
 */
export async function assertCanBookVehicle(
  scope: BookerScope,
  vehicleId: number,
): Promise<{ ok: true; vehicle: { id: number; name: string; regNumber: string; companyId: number; companyName: string } } | { ok: false; error: string }> {
  const [vehicle] = await db
    .select({
      id: vehicles.id,
      name: vehicles.name,
      regNumber: vehicles.regNumber,
      active: vehicles.active,
      companyId: vehicles.companyId,
      companyName: companies.name,
    })
    .from(vehicles)
    .innerJoin(companies, eq(vehicles.companyId, companies.id))
    .where(eq(vehicles.id, vehicleId))
    .limit(1);

  if (!vehicle) return { ok: false, error: "That vehicle isn't in the register." };
  if (!vehicle.active) {
    return { ok: false, error: `${vehicle.name} has been retired from the fleet.` };
  }
  if (!scope.canBookAnyCompany && vehicle.companyId !== scope.companyId) {
    return {
      ok: false,
      error:
        `${vehicle.name} belongs to ${vehicle.companyName}, and you can only book ` +
        `${scope.companyName ?? "your own company"}'s vehicles. A Director can allow you to book ` +
        `other companies' vehicles from the Team Members page.`,
    };
  }
  return {
    ok: true,
    vehicle: {
      id: vehicle.id,
      name: vehicle.name,
      regNumber: vehicle.regNumber,
      companyId: vehicle.companyId,
      companyName: vehicle.companyName,
    },
  };
}

/**
 * Who may fill in the return: whoever signed it out, whoever it was signed out
 * for, or whoever looks after the fleet. Note this decides who may *start* the
 * return — the one-time code is what decides whether they finish it.
 */
export function canReturnBooking(
  user: SessionUser,
  booking: { bookedByUserId: number | null; bookedForUserId: number | null },
): boolean {
  if (booking.bookedByUserId === user.id) return true;
  if (booking.bookedForUserId === user.id) return true;
  return hasPermission(user, "vehicles.manage");
}
