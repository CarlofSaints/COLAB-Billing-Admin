import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { buildAuthorizeUrl, xeroHasCreds, xeroRedirectUri } from "@/lib/xero";

/** Kicks off the Xero OAuth flow: sets a state cookie and redirects to Xero. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "integrations.manage")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (!(await xeroHasCreds())) {
    return NextResponse.redirect(new URL("/integrations?xero=nocreds", req.url));
  }

  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("xero_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const authorizeUrl = await buildAuthorizeUrl(xeroRedirectUri(req), state);
  if (!authorizeUrl) return NextResponse.redirect(new URL("/integrations?xero=nocreds", req.url));
  return NextResponse.redirect(authorizeUrl);
}
