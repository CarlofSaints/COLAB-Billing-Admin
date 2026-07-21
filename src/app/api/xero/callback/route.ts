import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { exchangeCodeForToken, xeroRedirectUri, xeroStatus } from "@/lib/xero";

/** Handles the redirect back from Xero: validates state, swaps code for tokens. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const jar = await cookies();
  const savedState = jar.get("xero_oauth_state")?.value;
  jar.delete("xero_oauth_state");

  if (error) return NextResponse.redirect(new URL("/integrations?xero=error", req.url));
  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(new URL("/integrations?xero=error", req.url));
  }

  try {
    await exchangeCodeForToken(code, xeroRedirectUri(req));
    const status = await xeroStatus();
    const user = await getCurrentUser();
    await logEvent({
      action: "integration.xero_connected",
      summary: `Connected Xero organisation “${status.tenantName ?? "unknown"}”`,
      actor: user,
      entityType: "integration",
      entityId: "xero",
      metadata: { tenant: status.tenantName },
    });
    return NextResponse.redirect(new URL("/integrations?xero=connected", req.url));
  } catch {
    return NextResponse.redirect(new URL("/integrations?xero=error", req.url));
  }
}
