import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, roles, rolePermissions, permissions } from "@/db/schema";

const COOKIE_NAME = "colab_session";
const SESSION_DAYS = 7;

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return new TextEncoder().encode(secret);
}

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
};

/* ------------------------------------------------------------------ */
/* Password helpers                                                   */
/* ------------------------------------------------------------------ */

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/* ------------------------------------------------------------------ */
/* Session cookie                                                     */
/* ------------------------------------------------------------------ */

export async function createSession(userId: number) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

async function getUserIdFromCookie(): Promise<number | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const uid = payload.uid;
    return typeof uid === "number" ? uid : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Loading the current user (memoized per request)                    */
/* ------------------------------------------------------------------ */

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const uid = await getUserIdFromCookie();
  if (!uid) return null;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      active: users.active,
      roleKey: roles.key,
      roleName: roles.name,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, uid))
    .limit(1);

  const u = rows[0];
  if (!u || !u.active) return null;

  const perms = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
    .where(eq(roles.key, u.roleKey));

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roleKey: u.roleKey,
    roleName: u.roleName,
    permissions: perms.map((p) => p.key),
  };
});

/* ------------------------------------------------------------------ */
/* Guards                                                             */
/* ------------------------------------------------------------------ */

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function hasPermission(user: SessionUser, key: string): boolean {
  // Super admin is all-powerful regardless of stored grid state.
  if (user.roleKey === "super_admin") return true;
  return user.permissions.includes(key);
}

export async function requirePermission(key: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user, key)) redirect("/?denied=" + encodeURIComponent(key));
  return user;
}
