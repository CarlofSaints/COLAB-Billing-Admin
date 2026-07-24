import "server-only";
import { headers } from "next/headers";

/**
 * Thin wrapper over Resend for transactional (one-recipient) mail such as
 * user-credential handovers. Bulk announcements have their own send path in
 * `app/actions/mail.ts`.
 */

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export type SendResult = { ok: true } | { ok: false; error: string };

export async function sendMail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from) {
    return { ok: false, error: "Email isn't configured (RESEND_API_KEY / MAIL_FROM)." };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: [input.to],
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

export type OutgoingMessage = { to: string; subject: string; html: string; text: string };

/**
 * Sends one personalised email per recipient via Resend's batch endpoint
 * (100 per call). Each person gets their own message — no shared bcc — so
 * merge tokens work and recipients never see each other.
 */
export async function sendBatch(
  messages: OutgoingMessage[],
): Promise<{ sent: number; failed: number; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from) {
    return { sent: 0, failed: messages.length, error: "Email isn't configured." };
  }
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  let sent = 0;
  let failed = 0;
  let firstError: string | undefined;

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
      }
    } catch (err) {
      failed += chunk.length;
      firstError ??= err instanceof Error ? err.message : "Unknown send error";
    }
  }

  return { sent, failed, error: firstError };
}

/** The app's public base URL, taken from the incoming request. */
export async function appBaseUrl(): Promise<string> {
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "https";
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${proto}://${host}`;
  } catch {
    // No request scope (e.g. a background invocation) — fall through.
  }
  const fallback = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return fallback ? `https://${fallback}` : "https://colab-billing-admin.vercel.app";
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
