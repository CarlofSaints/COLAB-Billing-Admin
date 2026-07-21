import "server-only";
import { inArray, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { encryptSecret, decryptSecret } from "./secrets";
import { ALL_INTEGRATION_KEYS } from "./integrations-fields";

const PREFIX = "integration:";

/** Store an encrypted integration secret. */
export async function setSecretValue(key: string, value: string) {
  const enc = encryptSecret(value);
  await db
    .insert(appSettings)
    .values({ key: PREFIX + key, value: enc })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: enc, updatedAt: new Date() } });
}

export async function removeSecretValue(key: string) {
  await db.delete(appSettings).where(eq(appSettings.key, PREFIX + key));
}

/** Decrypt and return a stored secret (for use when calling the provider's API). */
export async function getSecretValue(key: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, PREFIX + key))
    .limit(1);
  if (!rows[0]?.value) return null;
  try {
    return decryptSecret(rows[0].value);
  } catch {
    return null;
  }
}

export type FieldStatus = { set: boolean; hint?: string };

/**
 * Returns, for every integration field, whether it's set and a short masked
 * hint (last 4 chars) — never the full secret.
 */
export async function getIntegrationStatuses(): Promise<Record<string, FieldStatus>> {
  const keys = ALL_INTEGRATION_KEYS.map((k) => PREFIX + k);
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const out: Record<string, FieldStatus> = {};
  for (const k of ALL_INTEGRATION_KEYS) {
    const enc = byKey.get(PREFIX + k);
    if (!enc) {
      out[k] = { set: false };
      continue;
    }
    let hint: string | undefined;
    try {
      const plain = decryptSecret(enc);
      hint = plain.length > 4 ? "••" + plain.slice(-4) : "••••";
    } catch {
      hint = undefined;
    }
    out[k] = { set: true, hint };
  }
  return out;
}
