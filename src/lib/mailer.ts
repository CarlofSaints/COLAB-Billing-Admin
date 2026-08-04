import "server-only";
import { headers } from "next/headers";
import { graphConfigured, graphSender, sendViaGraph } from "./graph-mail";

// The templates are pure and live next door so they can be rendered outside a
// Next request (see scripts/preview-emails.ts). Re-exported here because every
// caller already imports its template and `sendMail` from the same place.
export {
  bookingConfirmedEmail,
  bookingHandedOverEmail,
  bookingReminderEmail,
  bookingTakenOverEmail,
  credentialsEmail,
  hubInviteEmail,
  issueReportedEmail,
  receptionDutyReminderEmail,
  receptionSwapOutcomeEmail,
  receptionSwapRequestEmail,
  roomStealApprovedEmail,
  roomStealDeclinedEmail,
  roomStealRequestEmail,
  signupNotifyEmail,
  taskAssignedEmail,
  taskCreatedEmail,
  vehicleReturnOtpEmail,
} from "./email-templates";

/**
 * The app's outbound mail layer. Every send in the codebase goes through
 * `sendMail`, `sendBatch` or `sendBcc` — nothing talks to a provider directly.
 *
 * Two transports are supported:
 *   graph  — Microsoft Graph, sending as a real Exchange Online mailbox
 *   resend — the original Resend API, from billing.colab2.co.za
 *
 * Graph is preferred whenever it's configured, because COLAB's recipients are
 * overwhelmingly on Microsoft 365 and mail from a genuine @colab2.co.za mailbox
 * clears their filtering far more reliably than a cold subdomain. Resend stays
 * wired in as an automatic fallback so a Graph outage, an expired client secret
 * or a throttle never means a silently unsent notification. Set
 * MAIL_PROVIDER=resend to force the old behaviour.
 */

export type MailProvider = "graph" | "resend";

function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export function mailConfigured(): boolean {
  return graphConfigured() || resendConfigured();
}

/** Which transports to try, best first. Unconfigured ones are dropped. */
function providerOrder(): MailProvider[] {
  const preferred: MailProvider = process.env.MAIL_PROVIDER === "resend" ? "resend" : "graph";
  const order: MailProvider[] = preferred === "graph" ? ["graph", "resend"] : ["resend", "graph"];
  return order.filter((p) => (p === "graph" ? graphConfigured() : resendConfigured()));
}

/** The address recipients will see, for the configured transport. */
export function mailFromAddress(): string | undefined {
  return providerOrder()[0] === "graph" ? graphSender() : process.env.MAIL_FROM;
}

/** Which transports are wired up and which one mail actually leaves by. */
export function mailStatus(): {
  configured: boolean;
  primary?: MailProvider;
  fallback?: MailProvider;
  from?: string;
} {
  const [primary, fallback] = providerOrder();
  return { configured: Boolean(primary), primary, fallback, from: mailFromAddress() };
}

export type SendResult = { ok: true; provider: MailProvider } | { ok: false; error: string };

export type OutgoingMessage = { to: string; subject: string; html: string; text: string };

async function sendViaResend(input: {
  to: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY!);
    const { error } = await resend.emails.send({
      from: process.env.MAIL_FROM!,
      to: input.to,
      ...(input.bcc?.length ? { bcc: input.bcc } : {}),
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown send error" };
  }
}

/**
 * Attempts each configured transport in turn and reports which one delivered,
 * so activity-log entries can say how a message actually went out.
 */
async function send(input: {
  to: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const providers = providerOrder();
  if (providers.length === 0) {
    return { ok: false, error: "Email isn't configured (GRAPH_* or RESEND_API_KEY / MAIL_FROM)." };
  }

  const errors: string[] = [];
  for (const provider of providers) {
    const result =
      provider === "graph"
        ? await sendViaGraph({ to: input.to, bcc: input.bcc, subject: input.subject, html: input.html, text: input.text })
        : await sendViaResend(input);

    if (result.ok) {
      if (errors.length) {
        // Surfaced in Vercel logs — a fallback that goes unnoticed is a
        // transport quietly rotting until both providers are broken.
        console.warn(`[mail] fell back to ${provider} after: ${errors.join(" | ")}`);
      }
      return { ok: true, provider };
    }
    errors.push(`${provider}: ${result.error}`);
  }

  return { ok: false, error: errors.join(" | ") };
}

/** Sends one message to one recipient. */
export async function sendMail(input: OutgoingMessage): Promise<SendResult> {
  return send({ to: [input.to], subject: input.subject, html: input.html, text: input.text });
}

/**
 * Sends one announcement to many people at once — a single message addressed to
 * COLAB itself with everyone bcc'd, so recipients never see each other. One
 * request rather than N also keeps well clear of Exchange's per-mailbox rate
 * limits when a group is large.
 */
export async function sendBcc(input: {
  bcc: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const visible = mailFromAddress();
  if (!visible) {
    return { ok: false, error: "Email isn't configured (GRAPH_* or RESEND_API_KEY / MAIL_FROM)." };
  }
  return send({ to: [visible], bcc: input.bcc, subject: input.subject, html: input.html, text: input.text });
}

/**
 * Sends one personalised email per recipient, so merge tokens work and nobody
 * sees anyone else's address.
 *
 * Resend takes 100 per API call. Graph has no batch send, so those go one at a
 * time with a short gap between them — Exchange Online throttles a mailbox that
 * submits in a tight loop, and a throttled reminder run is worse than a slow one.
 */
export async function sendBatch(
  messages: OutgoingMessage[],
): Promise<{ sent: number; failed: number; error?: string; byProvider: Partial<Record<MailProvider, number>> }> {
  if (messages.length === 0) return { sent: 0, failed: 0, byProvider: {} };

  const providers = providerOrder();
  if (providers.length === 0) {
    return { sent: 0, failed: messages.length, error: "Email isn't configured.", byProvider: {} };
  }

  let sent = 0;
  let failed = 0;
  let firstError: string | undefined;
  const byProvider: Partial<Record<MailProvider, number>> = {};

  // Resend's batch endpoint is a genuine bulk call, so use it when Resend is
  // the primary transport. Otherwise fall through to per-message sends, which
  // still get Resend as a per-message fallback.
  if (providers[0] === "resend") {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY!);
    const from = process.env.MAIL_FROM!;

    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const { error } = await resend.batch.send(
          chunk.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text })),
        );
        if (error) {
          failed += chunk.length;
          firstError ??= error.message;
        } else {
          sent += chunk.length;
          byProvider.resend = (byProvider.resend ?? 0) + chunk.length;
        }
      } catch (err) {
        failed += chunk.length;
        firstError ??= err instanceof Error ? err.message : "Unknown send error";
      }
    }

    return { sent, failed, error: firstError, byProvider };
  }

  for (const [index, message] of messages.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 200));
    const result = await sendMail(message);
    if (result.ok) {
      sent += 1;
      byProvider[result.provider] = (byProvider[result.provider] ?? 0) + 1;
    } else {
      failed += 1;
      firstError ??= result.error;
    }
  }

  return { sent, failed, error: firstError, byProvider };
}

/** "2 via graph, 1 via resend" — for activity-log summaries. */
export function describeProviders(byProvider: Partial<Record<MailProvider, number>>): string {
  const parts = (Object.entries(byProvider) as [MailProvider, number][])
    .filter(([, count]) => count > 0)
    .map(([provider, count]) => `${count} via ${provider}`);
  return parts.join(", ");
}

/**
 * The app's public base URL for links in emails and shared invites.
 *
 * APP_BASE_URL wins when set — it pins every link (including background/cron
 * sends that have no request to read a host from) to the canonical domain.
 * Without it we fall back to the incoming request's host, then Vercel's.
 */
export async function appBaseUrl(): Promise<string> {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "https";
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${proto}://${host}`;
  } catch {
    // No request scope (e.g. a background invocation) — fall through.
  }
  const fallback = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return fallback ? `https://${fallback}` : "https://hub.colab2.co.za";
}

