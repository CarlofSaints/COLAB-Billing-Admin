"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { setSecretValue, removeSecretValue } from "@/lib/integrations";
import { XERO_FIELDS, DEXT_FIELDS, type IntegrationField } from "@/lib/integrations-fields";

export type IntegrationState = { error?: string; ok?: boolean };

async function saveFields(
  provider: string,
  fields: IntegrationField[],
  formData: FormData,
): Promise<IntegrationState> {
  const user = await requirePermission("integrations.manage");

  let changed = 0;
  for (const f of fields) {
    // A ticked "clear_<key>" removes the stored value.
    if (formData.get(`clear_${f.key}`)) {
      await removeSecretValue(f.key);
      changed++;
      continue;
    }
    const value = String(formData.get(f.key) ?? "").trim();
    if (value) {
      await setSecretValue(f.key, value);
      changed++;
    }
    // A blank field leaves the existing value untouched.
  }

  await logEvent({
    action: `integration.${provider}_update`,
    summary: `Updated ${provider === "xero" ? "Xero" : "Dext"} credentials`,
    actor: user,
    entityType: "integration",
    entityId: provider,
    metadata: { fieldsChanged: changed },
  });

  revalidatePath("/integrations");
  return { ok: true };
}

export async function saveXero(_prev: IntegrationState, formData: FormData) {
  return saveFields("xero", XERO_FIELDS, formData);
}

export async function saveDext(_prev: IntegrationState, formData: FormData) {
  return saveFields("dext", DEXT_FIELDS, formData);
}
