import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getCurrentUser, hasPermission } from "./auth";

/**
 * Restricted values (salaries, and anything else marked sensitive) are hidden
 * behind two gates: the `values.restricted` permission, and a re-entry of the
 * user's own password. The password grant is a short-lived signed cookie.
 *
 * Masking happens on the server — a hidden amount is never sent to the
 * browser, so it can't be read out of the page payload.
 */

const COOKIE = "colab_reveal";
const GRANT_MINUTES = 15;

export const MASK = "•••••";

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set.");
  return new TextEncoder().encode(value);
}

/** Issues the short-lived grant after a successful password check. */
export async function grantReveal(userId: number): Promise<void> {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${GRANT_MINUTES}m`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GRANT_MINUTES * 60,
  });
}

export async function revokeReveal(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/**
 * Whether restricted amounts should be shown to whoever is asking: they need
 * the permission AND a live password grant belonging to them.
 */
export async function canRevealValues(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "values.restricted")) return false;

  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.uid === user.id;
  } catch {
    return false;
  }
}

/** Whether the user could reveal, if they entered their password. */
export async function mayRequestReveal(): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "values.restricted"));
}

export type RevealState = {
  /** Restricted amounts are currently visible. */
  unlocked: boolean;
  /** The user is allowed to unlock them by entering their password. */
  canUnlock: boolean;
};

export async function revealState(): Promise<RevealState> {
  const [unlocked, canUnlock] = await Promise.all([canRevealValues(), mayRequestReveal()]);
  return { unlocked, canUnlock };
}

/**
 * Returns the amount, or null when it must stay hidden. Callers send null to
 * the client and render the mask — never the real figure.
 */
export function maskAmount(amount: number, sensitive: boolean, unlocked: boolean): number | null {
  return sensitive && !unlocked ? null : amount;
}
