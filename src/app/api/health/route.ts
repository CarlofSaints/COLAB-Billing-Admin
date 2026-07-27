import { NextResponse } from "next/server";
import { mailStatus } from "@/lib/mailer";

/**
 * Simple health check. Confirms the app is up and whether the core
 * integrations (database URL, email) are configured — without exposing secrets.
 */
export async function GET() {
  const mail = mailStatus();
  return NextResponse.json({
    ok: true,
    service: "colab-billing-admin",
    time: new Date().toISOString(),
    config: {
      database: Boolean(process.env.DATABASE_URL),
      auth: Boolean(process.env.AUTH_SECRET),
      email: mail.configured,
      // Which transport mail leaves by, so a silent fallback to the wrong
      // sender is visible without digging through logs.
      emailPrimary: mail.primary ?? null,
      emailFallback: mail.fallback ?? null,
      emailFrom: mail.from ?? null,
    },
  });
}
