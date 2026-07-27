import "server-only";

/**
 * Sends mail through Microsoft Graph as a real Exchange Online mailbox.
 *
 * Why this exists alongside Resend: COLAB's recipients are almost all on
 * Microsoft 365, and mail from a never-before-seen subdomain
 * (billing.colab2.co.za) is exactly the profile Exchange Online Protection
 * files as junk. Sending as `@colab2.co.za` from a genuine mailbox aligns SPF
 * automatically, carries the domain's real correspondence history, and — for
 * outerjoin.co.za, which shares COLAB's tenant — never leaves Microsoft at all.
 *
 * We submit RFC 5322 MIME rather than Graph's JSON message shape so that every
 * message keeps its text/plain alternative alongside the HTML. Single-part HTML
 * scores worse with spam filters, and the templates in `mailer.ts` already
 * write both bodies.
 *
 * Required env (either spelling — see `env()` below):
 *   GRAPH_TENANT_ID     / OJ_TENANT_ID      Directory (tenant) ID
 *   GRAPH_CLIENT_ID     / OJ_CLIENT_ID      Application (client) ID
 *   GRAPH_CLIENT_SECRET / OJ_CLIENT_SECRET  Client secret value
 *   GRAPH_SENDER        / OJ_SENDER         Mailbox to send as, e.g. hub@colab2.co.za
 * Optional:
 *   GRAPH_SENDER_NAME   / OJ_SENDER_NAME    Display name on the From header (default "COLAB")
 *   GRAPH_REPLY_TO      / OJ_REPLY_TO       Reply-To address if replies should go elsewhere
 */

const TOKEN_SCOPE = "https://graph.microsoft.com/.default";

/**
 * Returns the first of these env vars that holds a value.
 *
 * The app registration behind these credentials belongs to OuterJoin —
 * colab2.co.za is a verified domain in that same Entra tenant — and they're
 * stored under OJ_* names elsewhere. Accepting both spellings means the same
 * credentials can be pasted into any project without a rename, and without a
 * silent misconfiguration if the wrong prefix gets used.
 */
function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

const tenantId = () => env("GRAPH_TENANT_ID", "OJ_TENANT_ID");
const clientId = () => env("GRAPH_CLIENT_ID", "OJ_CLIENT_ID");
const clientSecret = () => env("GRAPH_CLIENT_SECRET", "OJ_CLIENT_SECRET");

export function graphConfigured(): boolean {
  return Boolean(tenantId() && clientId() && clientSecret() && graphSender());
}

export function graphSender(): string | undefined {
  return env("GRAPH_SENDER", "OJ_SENDER");
}

/**
 * Cached app-only token. Module scope, so a warm Vercel instance reuses it
 * across invocations; a cold start just fetches a new one.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const now = Date.now();
  // Refresh a minute early so a token can't expire mid-request.
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const tenant = tenantId()!;
  const body = new URLSearchParams({
    client_id: clientId()!,
    client_secret: clientSecret()!,
    scope: TOKEN_SCOPE,
    grant_type: "client_credentials",
  });

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    | null;

  if (!res.ok || !json?.access_token) {
    const detail = json?.error_description ?? json?.error ?? `HTTP ${res.status}`;
    // Strip the multi-line trace IDs Entra appends — the first line is the useful bit.
    throw new Error(`Graph token request failed: ${String(detail).split("\n")[0]}`);
  }

  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

/** Wraps base64 at 76 characters with CRLF, as RFC 2045 requires. */
function base64Body(value: string): string {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return (encoded.match(/.{1,76}/g) ?? []).join("\r\n");
}

/** RFC 2047 encodes a header value only when it isn't plain printable ASCII. */
function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?utf-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function fromHeader(): string {
  const address = graphSender()!;
  const name = env("GRAPH_SENDER_NAME", "OJ_SENDER_NAME") ?? "COLAB";
  return `${encodeHeader(`"${name.replace(/"/g, "")}"`)} <${address}>`;
}

export type GraphMessage = {
  to: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
};

function buildMime(message: GraphMessage): string {
  const boundary = `colab-${crypto.randomUUID()}`;
  const replyTo = env("GRAPH_REPLY_TO", "OJ_REPLY_TO");

  const headers = [
    `From: ${fromHeader()}`,
    `To: ${message.to.join(", ")}`,
    message.bcc?.length ? `Bcc: ${message.bcc.join(", ")}` : null,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter((line): line is string => line !== null);

  return [
    ...headers,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(message.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export type GraphSendResult = { ok: true } | { ok: false; error: string };

/**
 * Submits one message. Exchange strips the Bcc header before delivery, so a
 * single call can reach a whole announcement audience without exposing the
 * recipient list or burning a request per person against Graph's throttles.
 */
export async function sendViaGraph(message: GraphMessage, attempt = 0): Promise<GraphSendResult> {
  if (!graphConfigured()) {
    return { ok: false, error: "Microsoft Graph isn't configured (GRAPH_* / OJ_* env vars)." };
  }

  try {
    const token = await accessToken();
    const sender = graphSender()!;
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          // The MIME variant of sendMail takes base64 MIME as the whole body.
          "content-type": "text/plain",
        },
        body: Buffer.from(buildMime(message), "utf8").toString("base64"),
        cache: "no-store",
      },
    );

    if (res.status === 202) return { ok: true };

    // A stale cached token: drop it so the retry fetches a fresh one.
    if (res.status === 401 && attempt === 0) {
      cachedToken = null;
      return sendViaGraph(message, attempt + 1);
    }

    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(Number(res.headers.get("retry-after") ?? 5), 30);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return sendViaGraph(message, attempt + 1);
    }

    const detail = (await res.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    const code = detail?.error?.code;
    const text = detail?.error?.message ?? `HTTP ${res.status}`;
    return { ok: false, error: `Graph send failed${code ? ` (${code})` : ""}: ${text}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Graph send error" };
  }
}
