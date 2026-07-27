import "server-only";
import { headers } from "next/headers";
import { graphConfigured, graphSender, sendViaGraph } from "./graph-mail";

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The credential handover email — sent when an admin creates a user (or resets
 * a password) and asks for the details to be emailed.
 */
export function credentialsEmail(input: {
  name: string;
  email: string;
  password: string;
  loginUrl: string;
  mustChangePassword: boolean;
  isReset: boolean;
}) {
  const { name, email, password, loginUrl, mustChangePassword, isReset } = input;
  const subject = isReset
    ? "Your COLAB Billing password has been reset"
    : "Your COLAB Billing & Admin sign-in details";

  const intro = isReset
    ? "Your password for the COLAB Billing &amp; Admin portal has been reset. Use the temporary password below to sign in."
    : "An account has been created for you on the COLAB Billing &amp; Admin portal. Use the details below to sign in.";

  const closing = mustChangePassword
    ? "You'll be asked to choose your own password the first time you sign in."
    : "You can change your password at any time from the Account page.";

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#0f172a;max-width:520px">
    <p style="font-size:18px;font-weight:600;margin:0 0 16px">COLAB</p>
    <p>Hi ${escapeHtml(name)},</p>
    <p>${intro}</p>
    <table style="border-collapse:collapse;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
      <tr>
        <td style="padding:10px 14px;color:#64748b">Sign in at</td>
        <td style="padding:10px 14px"><a href="${loginUrl}" style="color:#1d4ed8">${escapeHtml(loginUrl)}</a></td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:#64748b;border-top:1px solid #e2e8f0">Email</td>
        <td style="padding:10px 14px;border-top:1px solid #e2e8f0">${escapeHtml(email)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:#64748b;border-top:1px solid #e2e8f0">Temporary password</td>
        <td style="padding:10px 14px;border-top:1px solid #e2e8f0"><code style="font-family:ui-monospace,Menlo,monospace;font-size:14px">${escapeHtml(password)}</code></td>
      </tr>
    </table>
    <p>${closing}</p>
    <p style="color:#64748b;font-size:12px;margin-top:24px">If you weren't expecting this email, please let the COLAB office know.</p>
  </div>`;

  const text = [
    `Hi ${name},`,
    "",
    isReset
      ? "Your password for the COLAB Billing & Admin portal has been reset."
      : "An account has been created for you on the COLAB Billing & Admin portal.",
    "",
    `Sign in at: ${loginUrl}`,
    `Email: ${email}`,
    `Temporary password: ${password}`,
    "",
    closing,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Welcome email when a team member is turned into a hub user — carries their
 * sign-in details and points them straight at their profile to fill in.
 */
export function hubInviteEmail(input: {
  name: string;
  email: string;
  password: string;
  loginUrl: string;
  profileUrl: string;
}) {
  const { name, email, password, loginUrl, profileUrl } = input;
  const subject = "You're on the COLAB Team Hub — set up your profile";

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#0f172a;max-width:520px">
    <p style="font-size:18px;font-weight:600;margin:0 0 16px">COLAB Team Hub</p>
    <p>Hi ${escapeHtml(name)},</p>
    <p>You've been added to the COLAB Team Hub. Sign in with the details below, then tell everyone a bit about yourself — what you do, your birthday, hobbies and more.</p>
    <table style="border-collapse:collapse;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
      <tr>
        <td style="padding:10px 14px;color:#64748b">Sign in at</td>
        <td style="padding:10px 14px"><a href="${loginUrl}" style="color:#1d4ed8">${escapeHtml(loginUrl)}</a></td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:#64748b;border-top:1px solid #e2e8f0">Email</td>
        <td style="padding:10px 14px;border-top:1px solid #e2e8f0">${escapeHtml(email)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;color:#64748b;border-top:1px solid #e2e8f0">Temporary password</td>
        <td style="padding:10px 14px;border-top:1px solid #e2e8f0"><code style="font-family:ui-monospace,Menlo,monospace;font-size:14px">${escapeHtml(password)}</code></td>
      </tr>
    </table>
    <p><a href="${profileUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Set up my profile</a></p>
    <p style="color:#64748b">You'll be asked to choose your own password the first time you sign in.</p>
    <p style="color:#64748b;font-size:12px;margin-top:24px">If you weren't expecting this email, please let the COLAB office know.</p>
  </div>`;

  const text = [
    `Hi ${name},`,
    "",
    "You've been added to the COLAB Team Hub. Sign in and set up your profile:",
    "",
    `Sign in at: ${loginUrl}`,
    `Email: ${email}`,
    `Temporary password: ${password}`,
    "",
    `Set up your profile: ${profileUrl}`,
    "",
    "You'll be asked to choose your own password the first time you sign in.",
  ].join("\n");

  return { subject, html, text };
}

/**
 * Notifies a super admin that someone used the public join form, with a link
 * to review (approve / decline) the request in the app.
 */
export function signupNotifyEmail(input: {
  applicantName: string;
  applicantEmail: string;
  companyName: string;
  reviewUrl: string;
}) {
  const { applicantName, applicantEmail, companyName, reviewUrl } = input;
  const subject = `New hub sign-up: ${applicantName}`;

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#0f172a;max-width:520px">
    <p style="font-size:18px;font-weight:600;margin:0 0 16px">COLAB Team Hub</p>
    <p>Someone has asked to join the Team Hub. Nothing has been created yet — it's waiting for your approval.</p>
    <table style="border-collapse:collapse;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
      <tr><td style="padding:10px 14px;color:#64748b">Name</td><td style="padding:10px 14px">${escapeHtml(applicantName)}</td></tr>
      <tr><td style="padding:10px 14px;color:#64748b;border-top:1px solid #e2e8f0">Email</td><td style="padding:10px 14px;border-top:1px solid #e2e8f0">${escapeHtml(applicantEmail)}</td></tr>
      <tr><td style="padding:10px 14px;color:#64748b;border-top:1px solid #e2e8f0">Company</td><td style="padding:10px 14px;border-top:1px solid #e2e8f0">${escapeHtml(companyName)}</td></tr>
    </table>
    <p><a href="${reviewUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Review request</a></p>
  </div>`;

  const text = [
    "Someone has asked to join the COLAB Team Hub. It's waiting for your approval.",
    "",
    `Name: ${applicantName}`,
    `Email: ${applicantEmail}`,
    `Company: ${companyName}`,
    "",
    `Review it here: ${reviewUrl}`,
  ].join("\n");

  return { subject, html, text };
}

function taskDetailsTable(rows: [string, string][]): string {
  return `<table style="border-collapse:collapse;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">${rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:10px 14px;color:#64748b${i ? ";border-top:1px solid #e2e8f0" : ""}">${escapeHtml(k)}</td><td style="padding:10px 14px${i ? ";border-top:1px solid #e2e8f0" : ""}">${escapeHtml(v)}</td></tr>`,
    )
    .join("")}</table>`;
}

/** Sent to the assignee when a task is created for them (or as a reminder). */
export function taskAssignedEmail(input: {
  assigneeName: string;
  taskName: string;
  description?: string | null;
  dueDate?: string | null;
  priorityLabel: string;
  recurrenceLabel: string;
  assignedByName: string;
  tasksUrl: string;
  isReminder?: boolean;
}) {
  const {
    assigneeName,
    taskName,
    description,
    dueDate,
    priorityLabel,
    recurrenceLabel,
    assignedByName,
    tasksUrl,
    isReminder,
  } = input;
  const subject = isReminder
    ? `Reminder: ${taskName}`
    : `New task for you: ${taskName}`;

  const lead = isReminder
    ? `A quick reminder about a task assigned to you${assignedByName ? ` by ${escapeHtml(assignedByName)}` : ""}:`
    : `${escapeHtml(assignedByName)} has assigned you a task on the COLAB hub:`;

  const rows: [string, string][] = [["Task", taskName]];
  if (description) rows.push(["Details", description]);
  if (dueDate) rows.push(["Due", dueDate]);
  rows.push(["Priority", priorityLabel]);
  rows.push(["Repeats", recurrenceLabel]);

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#0f172a;max-width:520px">
    <p style="font-size:18px;font-weight:600;margin:0 0 16px">COLAB Team Hub</p>
    <p>Hi ${escapeHtml(assigneeName)},</p>
    <p>${lead}</p>
    ${taskDetailsTable(rows)}
    <p><a href="${tasksUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">View my tasks</a></p>
  </div>`;

  const text = [
    `Hi ${assigneeName},`,
    "",
    isReminder ? `Reminder — task: ${taskName}` : `${assignedByName} assigned you a task: ${taskName}`,
    description ? `Details: ${description}` : "",
    dueDate ? `Due: ${dueDate}` : "",
    `Priority: ${priorityLabel}`,
    `Repeats: ${recurrenceLabel}`,
    "",
    `View your tasks: ${tasksUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

/** Sent to directors + admins when someone reports an office issue. */
export function issueReportedEmail(input: {
  category: string;
  detail: string;
  reporterName: string;
  issuesUrl: string;
}) {
  const { category, detail, reporterName, issuesUrl } = input;
  const subject = `Office issue reported: ${category}`;

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#0f172a;max-width:520px">
    <p style="font-size:18px;font-weight:600;margin:0 0 16px">COLAB — Issue reported</p>
    <p><strong>${escapeHtml(reporterName)}</strong> reported a <strong>${escapeHtml(category)}</strong> issue:</p>
    <blockquote style="margin:12px 0;padding:10px 14px;background:#f8fafc;border-left:3px solid #4f46e5;border-radius:4px;white-space:pre-wrap">${escapeHtml(detail)}</blockquote>
    <p><a href="${issuesUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">View & manage issues</a></p>
  </div>`;

  const text = [
    `${reporterName} reported a ${category} issue:`,
    "",
    detail,
    "",
    `View & manage: ${issuesUrl}`,
  ].join("\n");

  return { subject, html, text };
}

/** Confirmation to the creator that their task was scheduled. */
export function taskCreatedEmail(input: {
  creatorName: string;
  taskName: string;
  assigneeName: string;
  dueDate?: string | null;
  tasksUrl: string;
}) {
  const { creatorName, taskName, assigneeName, dueDate, tasksUrl } = input;
  const subject = `Task scheduled: ${taskName}`;

  const rows: [string, string][] = [
    ["Task", taskName],
    ["Assigned to", assigneeName],
  ];
  if (dueDate) rows.push(["Due", dueDate]);

  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#0f172a;max-width:520px">
    <p style="font-size:18px;font-weight:600;margin:0 0 16px">COLAB Team Hub</p>
    <p>Hi ${escapeHtml(creatorName)},</p>
    <p>Your task has been scheduled and ${escapeHtml(assigneeName)} has been notified.</p>
    ${taskDetailsTable(rows)}
    <p><a href="${tasksUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open admin tasks</a></p>
  </div>`;

  const text = [
    `Hi ${creatorName},`,
    "",
    `Your task "${taskName}" has been scheduled and ${assigneeName} has been notified.`,
    dueDate ? `Due: ${dueDate}` : "",
    "",
    `Open admin tasks: ${tasksUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
