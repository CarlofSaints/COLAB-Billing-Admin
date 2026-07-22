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

/** The app's public base URL, taken from the incoming request. */
export async function appBaseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`;
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
