import "server-only";
import { getSecretValue, setSecretValue, removeSecretValue } from "./integrations";

/**
 * Xero OAuth 2.0 (authorization code + refresh) for a Web app integration.
 * Client id/secret are entered on the Integrations page (encrypted via the
 * secret store). Tokens + the connected tenant are stored the same way.
 */

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const ORG_URL = "https://api.xero.com/api.xro/2.0/Organisation";

export const XERO_SCOPES = [
  "offline_access",
  "accounting.invoices",
  "accounting.invoices.read",
  "accounting.banktransactions.read",
  "accounting.contacts",
  "accounting.contacts.read",
  "accounting.settings.read",
].join(" ");

const K = {
  clientId: "xero_client_id",
  clientSecret: "xero_client_secret",
  accessToken: "xero_access_token",
  refreshToken: "xero_refresh_token",
  expiresAt: "xero_token_expires_at",
  tenantId: "xero_tenant_id",
  tenantName: "xero_tenant_name",
};

export function xeroRedirectUri(req: Request): string {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}/api/xero/callback`;
}

async function creds(): Promise<{ id: string; secret: string } | null> {
  const id = await getSecretValue(K.clientId);
  const secret = await getSecretValue(K.clientSecret);
  return id && secret ? { id, secret } : null;
}

export async function xeroHasCreds(): Promise<boolean> {
  return (await creds()) != null;
}

export async function buildAuthorizeUrl(redirectUri: string, state: string): Promise<string | null> {
  const c = await creds();
  if (!c) return null;
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", c.id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", XERO_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

function basicAuth(id: string, secret: string) {
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

async function storeTokens(data: { access_token: string; refresh_token: string; expires_in: number }) {
  await setSecretValue(K.accessToken, data.access_token);
  await setSecretValue(K.refreshToken, data.refresh_token);
  await setSecretValue(K.expiresAt, String(Date.now() + data.expires_in * 1000));
}

/** Exchange an authorization code for tokens, then record the connected tenant. */
export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<void> {
  const c = await creds();
  if (!c) throw new Error("Xero client credentials are not set.");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(c.id, c.secret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  await storeTokens(data);
  await recordTenant(data.access_token);
}

async function recordTenant(accessToken: string) {
  const res = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Fetching connections failed: ${res.status}`);
  const conns: { tenantId: string; tenantName: string; tenantType: string }[] = await res.json();
  // Prefer an ORGANISATION tenant; fall back to the first.
  const tenant = conns.find((t) => t.tenantType === "ORGANISATION") ?? conns[0];
  if (!tenant) throw new Error("No Xero organisation was connected.");
  await setSecretValue(K.tenantId, tenant.tenantId);
  await setSecretValue(K.tenantName, tenant.tenantName);
}

async function refreshAccessToken(): Promise<string | null> {
  const c = await creds();
  const refresh = await getSecretValue(K.refreshToken);
  if (!c || !refresh) return null;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(c.id, c.secret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  await storeTokens(data); // Xero rotates the refresh token on every use
  return data.access_token as string;
}

/** Returns a valid access token, refreshing if it's expired/near expiry. */
export async function getValidAccessToken(): Promise<string | null> {
  const access = await getSecretValue(K.accessToken);
  const expiresAt = Number((await getSecretValue(K.expiresAt)) ?? 0);
  if (!access) return null;
  if (Date.now() > expiresAt - 60_000) return refreshAccessToken();
  return access;
}

export async function getTenantId(): Promise<string | null> {
  return getSecretValue(K.tenantId);
}

export type XeroStatus = {
  configured: boolean; // client id + secret present
  connected: boolean; // tokens + tenant present
  tenantName: string | null;
};

export async function xeroStatus(): Promise<XeroStatus> {
  const configured = await xeroHasCreds();
  const tenantId = await getSecretValue(K.tenantId);
  const access = await getSecretValue(K.accessToken);
  return {
    configured,
    connected: Boolean(tenantId && access),
    tenantName: await getSecretValue(K.tenantName),
  };
}

export async function disconnectXero(): Promise<void> {
  await removeSecretValue(K.accessToken);
  await removeSecretValue(K.refreshToken);
  await removeSecretValue(K.expiresAt);
  await removeSecretValue(K.tenantId);
  await removeSecretValue(K.tenantName);
}

/** Live check: fetch the connected organisation's name from Xero. */
export async function fetchOrganisationName(): Promise<{ ok: boolean; name?: string; error?: string }> {
  const token = await getValidAccessToken();
  const tenantId = await getTenantId();
  if (!token || !tenantId) return { ok: false, error: "Not connected to Xero." };

  const res = await fetch(ORG_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
    },
  });
  if (!res.ok) return { ok: false, error: `Xero returned ${res.status}` };
  const data = await res.json();
  const name = data?.Organisations?.[0]?.Name as string | undefined;
  return { ok: true, name };
}
