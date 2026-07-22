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
const API_BASE = "https://api.xero.com/api.xro/2.0";
const ORG_URL = `${API_BASE}/Organisation`;

export const XERO_SCOPES = [
  "offline_access",
  "accounting.invoices",
  "accounting.invoices.read",
  "accounting.banktransactions.read",
  "accounting.contacts",
  "accounting.contacts.read",
  "accounting.settings.read",
  // Needed for the month-end P&L per expense account. Added after the first
  // connection, so an existing connection must be re-consented to pick it up.
  //
  // NB: the broad "accounting.reports.read" is rejected with invalid_scope —
  // apps created on or after 2 Mar 2026 (this one was) must use the granular
  // per-report scopes from the outset.
  "accounting.reports.profitandloss.read",
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

/** Authenticated GET against the Xero Accounting API for the pinned tenant. */
async function xeroGet<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const token = await getValidAccessToken();
  const tenantId = await getTenantId();
  if (!token || !tenantId) return { ok: false, error: "Not connected to Xero." };

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    return { ok: false, error: `Xero returned ${res.status} for ${path}` };
  }
  return { ok: true, data: (await res.json()) as T };
}

export type XeroAccount = {
  accountId: string;
  code: string | null;
  name: string;
  type: string | null;
  description: string | null;
};

type RawAccount = {
  AccountID: string;
  Code?: string;
  Name: string;
  Type?: string;
  Class?: string;
  Status?: string;
  Description?: string;
};

/**
 * Every active expense account on the chart of accounts — i.e. the P&L cost
 * lines COLAB can recharge. Xero groups these under Class = EXPENSE, which
 * spans the EXPENSE / OVERHEADS / DIRECTCOSTS / DEPRECIATN types.
 */
export async function fetchExpenseAccounts(): Promise<
  { ok: true; accounts: XeroAccount[] } | { ok: false; error: string }
> {
  const res = await xeroGet<{ Accounts?: RawAccount[] }>("/Accounts");
  if (!res.ok) return res;

  const accounts = (res.data.Accounts ?? [])
    .filter((a) => a.Class === "EXPENSE" && (a.Status ?? "ACTIVE") === "ACTIVE")
    .map((a) => ({
      accountId: a.AccountID,
      code: a.Code ?? null,
      name: a.Name,
      type: a.Type ?? null,
      description: a.Description ?? null,
    }))
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "", undefined, { numeric: true }));

  return { ok: true, accounts };
}

/* ------------------------------------------------------------------ */
/* Monthly spend, by supplier and expense account                     */
/* ------------------------------------------------------------------ */

type RawLine = {
  AccountCode?: string;
  LineAmount?: number;
  TaxAmount?: number;
  Description?: string;
};
type RawDoc = {
  Type?: string;
  Status?: string;
  /** "Exclusive" | "Inclusive" | "NoTax" — decides what LineAmount means. */
  LineAmountTypes?: string;
  Contact?: { ContactID?: string; Name?: string };
  LineItems?: RawLine[];
};

/**
 * The VAT-exclusive value of a line. On documents captured tax-inclusive,
 * LineAmount already contains the VAT, so billing off it unchecked would
 * recharge 15% too much.
 */
function netAmount(doc: RawDoc, line: RawLine): number {
  const gross = line.LineAmount ?? 0;
  if (doc.LineAmountTypes === "Inclusive") return gross - (line.TaxAmount ?? 0);
  return gross;
}

/**
 * Only approved documents count as cost. DRAFT and SUBMITTED bills are still
 * awaiting approval and do not appear on the P&L, so billing off them would
 * recharge costs the business hasn't accepted yet — and would disagree with
 * the accounts. DELETED and VOIDED are self-evidently excluded.
 */
const BILLABLE_STATUSES = new Set(["AUTHORISED", "PAID"]);

export type SupplierSpendRow = {
  /** Composite key: `${accountCode}|${contactId}`. */
  key: string;
  accountCode: string;
  contactId: string;
  supplierName: string;
  /** Excluding VAT — the correct basis for a recharge. */
  amount: number;
  /** How many source documents contributed. */
  documents: number;
};

function xeroDate(year: number, monthIndex0: number, day: number) {
  return `DateTime(${year},${String(monthIndex0 + 1).padStart(2, "0")},${String(day).padStart(2, "0")})`;
}

/** Fetches every page of a Xero collection endpoint (100 rows per page). */
async function getAllPages<T>(
  path: string,
  where: string,
  collection: string,
  extraQuery = "",
): Promise<{ ok: true; rows: T[] } | { ok: false; error: string }> {
  const rows: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const query = [
      where ? `where=${encodeURIComponent(where)}` : "",
      extraQuery,
      `page=${page}`,
    ]
      .filter(Boolean)
      .join("&");
    const res = await xeroGet<Record<string, T[]>>(`${path}?${query}`);
    if (!res.ok) return res;
    const batch = res.data[collection] ?? [];
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return { ok: true, rows };
}

/**
 * Every supplier's spend for a billing month, broken down by expense account.
 *
 * Covers supplier bills, spend money out of the bank, and supplier credit
 * notes (which subtract). Manual journals are NOT included — that scope isn't
 * granted — so these figures can differ from the P&L; treat the P&L as the
 * control total and surface any gap rather than hiding it.
 */
export async function fetchSupplierSpend(
  period: string,
): Promise<{ ok: true; rows: SupplierSpendRow[]; total: number } | { ok: false; error: string }> {
  const [yearStr, monthStr] = period.split("-");
  const year = Number(yearStr);
  const month0 = Number(monthStr) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(month0)) {
    return { ok: false, error: `Invalid period "${period}".` };
  }
  const nextYear = month0 === 11 ? year + 1 : year;
  const nextMonth0 = month0 === 11 ? 0 : month0 + 1;

  const range = `Date>=${xeroDate(year, month0, 1)} AND Date<${xeroDate(nextYear, nextMonth0, 1)}`;

  const [bills, credits, spend] = await Promise.all([
    getAllPages<RawDoc>("/Invoices", `Type=="ACCPAY" AND ${range}`, "Invoices"),
    getAllPages<RawDoc>("/CreditNotes", `Type=="ACCPAYCREDIT" AND ${range}`, "CreditNotes"),
    getAllPages<RawDoc>("/BankTransactions", `Type=="SPEND" AND ${range}`, "BankTransactions"),
  ]);
  for (const r of [bills, credits, spend]) if (!r.ok) return r;

  const byKey = new Map<string, SupplierSpendRow>();

  const absorb = (docs: RawDoc[], sign: 1 | -1) => {
    for (const doc of docs) {
      if (!BILLABLE_STATUSES.has(doc.Status ?? "")) continue;
      const contactId = doc.Contact?.ContactID ?? "unknown";
      const supplierName = doc.Contact?.Name ?? "(no supplier)";
      let touched = false;
      for (const line of doc.LineItems ?? []) {
        const accountCode = line.AccountCode;
        if (!accountCode) continue;
        const amount = netAmount(doc, line);
        if (!Number.isFinite(amount) || amount === 0) continue;
        const key = `${accountCode}|${contactId}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.amount += amount * sign;
        } else {
          byKey.set(key, {
            key,
            accountCode,
            contactId,
            supplierName,
            amount: amount * sign,
            documents: 0,
          });
        }
        touched = true;
      }
      if (!touched) continue;
      // Count the document once per account/supplier combination it touched.
      for (const line of doc.LineItems ?? []) {
        if (!line.AccountCode) continue;
        const row = byKey.get(`${line.AccountCode}|${contactId}`);
        if (row) row.documents += 1;
      }
    }
  };

  absorb((bills as { rows: RawDoc[] }).rows, 1);
  absorb((credits as { rows: RawDoc[] }).rows, -1);
  absorb((spend as { rows: RawDoc[] }).rows, 1);

  const rows = [...byKey.values()]
    .filter((r) => Math.abs(r.amount) > 0.005)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return { ok: true, rows, total };
}

export type XeroContact = {
  contactId: string;
  name: string;
  email: string | null;
  isCustomer: boolean;
  isSupplier: boolean;
};

/**
 * Every active contact in the org, for linking a sub-company to the contact
 * its invoices are raised against. Contacts that have only ever been billed
 * *by* are still valid invoice targets — Xero flips IsCustomer on the first
 * sales invoice — so suppliers are included rather than filtered out.
 */
export async function fetchContacts(): Promise<
  { ok: true; contacts: XeroContact[] } | { ok: false; error: string }
> {
  type Raw = {
    ContactID: string;
    Name: string;
    EmailAddress?: string;
    IsCustomer?: boolean;
    IsSupplier?: boolean;
    ContactStatus?: string;
  };

  const res = await getAllPages<Raw>("/Contacts", "", "Contacts", "summaryOnly=true");
  if (!res.ok) return res;

  const contacts = res.rows
    .filter((c) => (c.ContactStatus ?? "ACTIVE") === "ACTIVE")
    .map((c) => ({
      contactId: c.ContactID,
      name: c.Name,
      email: c.EmailAddress || null,
      isCustomer: Boolean(c.IsCustomer),
      isSupplier: Boolean(c.IsSupplier),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return { ok: true, contacts };
}

/* ------------------------------------------------------------------ */
/* Profit & Loss                                                      */
/* ------------------------------------------------------------------ */

type ReportCell = { Value?: string; Attributes?: { Id: string; Value: string }[] };
type ReportRow = { RowType: string; Title?: string; Cells?: ReportCell[]; Rows?: ReportRow[] };

/**
 * Per-account totals from the Profit & Loss for a month, keyed by Xero
 * AccountID. This is the authoritative figure: unlike the transaction
 * endpoints it includes manual journals — which is how payroll from an
 * outside system (Sage) reaches Xero.
 */
export async function fetchProfitAndLoss(
  period: string,
): Promise<{ ok: true; byAccountId: Map<string, number> } | { ok: false; error: string }> {
  const [yearStr, monthStr] = period.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return { ok: false, error: `Invalid period "${period}".` };
  }
  const from = `${period}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${period}-${String(lastDay).padStart(2, "0")}`;

  const res = await xeroGet<{ Reports?: { Rows?: ReportRow[] }[] }>(
    `/Reports/ProfitAndLoss?fromDate=${from}&toDate=${to}`,
  );
  if (!res.ok) return res;

  const byAccountId = new Map<string, number>();
  const walk = (rows: ReportRow[]) => {
    for (const row of rows) {
      if (row.Rows?.length) walk(row.Rows);
      const cells = row.Cells ?? [];
      // The account GUID lives in the first cell's attributes, under "account"
      // (TrialBalance uses "accountID" — this report does not).
      const accountId = cells[0]?.Attributes?.find(
        (a) => a.Id === "account" || a.Id === "accountID",
      )?.Value;
      if (!accountId) continue;
      const value = Number(cells[1]?.Value ?? 0);
      if (!Number.isFinite(value)) continue;
      byAccountId.set(accountId, (byAccountId.get(accountId) ?? 0) + value);
    }
  };
  walk(res.data.Reports?.[0]?.Rows ?? []);

  return { ok: true, byAccountId };
}

/* ------------------------------------------------------------------ */
/* Creating draft sales invoices                                      */
/* ------------------------------------------------------------------ */

export type DraftInvoiceInput = {
  contactId: string;
  /** Invoice date and due date, as YYYY-MM-DD. */
  date: string;
  dueDate: string;
  reference: string;
  lines: { description: string; amount: number }[];
};

export type DraftInvoiceResult = {
  ok: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  error?: string;
};

/**
 * Creates one ACCREC invoice in DRAFT. Amounts are sent tax-exclusive and the
 * tax rate is left to the income account's own default, so VAT is whatever
 * Xero would apply if the invoice were keyed by hand.
 */
export async function createDraftInvoice(
  input: DraftInvoiceInput,
  incomeAccountCode: string,
): Promise<DraftInvoiceResult> {
  const token = await getValidAccessToken();
  const tenantId = await getTenantId();
  if (!token || !tenantId) return { ok: false, error: "Not connected to Xero." };

  const body = {
    Invoices: [
      {
        Type: "ACCREC",
        Contact: { ContactID: input.contactId },
        Date: input.date,
        DueDate: input.dueDate,
        Reference: input.reference,
        Status: "DRAFT",
        LineAmountTypes: "Exclusive",
        LineItems: input.lines.map((l) => ({
          Description: l.description,
          Quantity: 1,
          UnitAmount: Number(l.amount.toFixed(2)),
          AccountCode: incomeAccountCode,
        })),
      },
    ],
  };

  const res = await fetch(`${API_BASE}/Invoices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    // Xero returns validation detail in the body; surface it rather than a bare status.
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      const messages = parsed?.Elements?.[0]?.ValidationErrors?.map(
        (e: { Message: string }) => e.Message,
      );
      if (messages?.length) detail = messages.join("; ");
      else if (parsed?.Message) detail = parsed.Message;
    } catch {
      /* keep the raw text */
    }
    return { ok: false, error: `Xero rejected the invoice (${res.status}): ${detail}` };
  }

  const data = JSON.parse(text);
  const invoice = data?.Invoices?.[0];
  return {
    ok: true,
    invoiceId: invoice?.InvoiceID,
    invoiceNumber: invoice?.InvoiceNumber,
  };
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
