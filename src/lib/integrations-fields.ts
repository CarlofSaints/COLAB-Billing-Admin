/**
 * Metadata describing the credential fields for each integration.
 * Client-safe (no secrets, no server-only imports) so the settings form can
 * render from it.
 */
export type IntegrationField = {
  key: string;
  label: string;
  secret?: boolean; // rendered as a password input and never echoed back
  optional?: boolean;
  placeholder?: string;
};

export const XERO_FIELDS: IntegrationField[] = [
  { key: "xero_client_id", label: "Client ID", placeholder: "From your Xero Web app" },
  { key: "xero_client_secret", label: "Client Secret", secret: true },
];

export const DEXT_FIELDS: IntegrationField[] = [
  { key: "dext_api_key", label: "API Key", secret: true },
  { key: "dext_client_id", label: "Client ID", optional: true },
  { key: "dext_client_secret", label: "Client Secret", secret: true, optional: true },
];

export const INTEGRATIONS = [
  {
    id: "xero",
    name: "Xero",
    blurb:
      "Paste the Client ID and Client Secret from your Xero Web app (developer.xero.com), save, then use the connection panel above to connect the COLAB organisation.",
    fields: XERO_FIELDS,
  },
] as const;

export const ALL_INTEGRATION_KEYS = [...XERO_FIELDS, ...DEXT_FIELDS].map((f) => f.key);

/** The non-optional field keys that must be set for a provider to be "configured". */
export const REQUIRED_KEYS: Record<string, string[]> = {
  xero: XERO_FIELDS.filter((f) => !f.optional).map((f) => f.key),
  dext: DEXT_FIELDS.filter((f) => !f.optional).map((f) => f.key),
};
