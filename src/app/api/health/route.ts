import { NextResponse } from "next/server";

/**
 * Simple health check. Confirms the app is up and whether the core
 * integrations (database URL, email) are configured — without exposing secrets.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "colab-billing-admin",
    time: new Date().toISOString(),
    config: {
      database: Boolean(process.env.DATABASE_URL),
      auth: Boolean(process.env.AUTH_SECRET),
      email: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM),
    },
  });
}
