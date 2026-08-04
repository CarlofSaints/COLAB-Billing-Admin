/**
 * Shared vocabulary for vehicle bookings — fuel levels, statuses, the mileage
 * sum and the one-time-code rules.
 *
 * Deliberately free of `server-only` and of any request-scoped API: the client
 * grid renders the same labels the server writes into the activity log and the
 * emails, and two lists of fuel levels that could drift is exactly how a form
 * ends up showing "Half" for something stored as "quarter".
 */

export type FuelLevel = "full" | "three_quarters" | "half" | "quarter" | "under_quarter";

/** Ordered fullest-first, which is the order a gauge reads. */
export const FUEL_LEVELS: { value: FuelLevel; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "three_quarters", label: "3 quarters" },
  { value: "half", label: "Half" },
  { value: "quarter", label: "Quarter" },
  { value: "under_quarter", label: "Less than a quarter" },
];

const FUEL_LABELS = new Map(FUEL_LEVELS.map((f) => [f.value, f.label]));

export function fuelLabel(value: FuelLevel | null | undefined): string {
  return value ? (FUEL_LABELS.get(value) ?? value) : "—";
}

export function isFuelLevel(value: unknown): value is FuelLevel {
  return typeof value === "string" && FUEL_LABELS.has(value as FuelLevel);
}

export type VehicleBookingStatus = "out" | "home" | "servicing";

/**
 * The words Carl asked for, verbatim. "At Home" is the one people read fastest
 * on a grid — it answers "can I take it?" without any further thought.
 */
export const STATUS_LABELS: Record<VehicleBookingStatus, string> = {
  out: "Vehicle is out",
  home: "At Home",
  servicing: "Vehicle being serviced",
};

/** Anything that isn't home is unavailable — the two are not the same thing. */
export function isVehicleAvailable(status: VehicleBookingStatus): boolean {
  return status === "home";
}

/**
 * Kilometres travelled. Null until both readings exist, rather than 0 — an
 * unreturned vehicle has not travelled zero kilometres, and showing 0 in the
 * Difference column would say it had.
 */
export function mileageDifference(
  opening: number | null | undefined,
  closing: number | null | undefined,
): number | null {
  if (opening == null || closing == null) return null;
  return closing - opening;
}

/** A vehicle's odometer, formatted the way South Africans read one. */
export function formatMileage(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-ZA").format(value);
}

/* ------------------------------------------------------------------ */
/* Sign-in one-time code                                              */
/* ------------------------------------------------------------------ */

/** Long enough that guessing is hopeless against a 5-attempt cap. */
export const OTP_LENGTH = 6;
/** Long enough to fetch the phone, short enough that a stale code is useless. */
export const OTP_TTL_MINUTES = 10;
/** After this many wrong tries the code is dead and a new one must be sent. */
export const OTP_MAX_ATTEMPTS = 5;
/** Stops a stuck "Resend" button turning into a mail flood. */
export const OTP_RESEND_SECONDS = 60;

/** Upper bound on an odometer reading, to catch a hand slipping on the keypad. */
export const MAX_MILEAGE = 9_999_999;
