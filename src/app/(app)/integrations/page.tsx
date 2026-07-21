import { requirePermission } from "@/lib/auth";
import { getIntegrationStatuses } from "@/lib/integrations";
import { xeroStatus } from "@/lib/xero";
import { PageHeader } from "@/components/ui/page";
import { IntegrationsClient } from "./integrations-client";

export const metadata = { title: "Integrations — COLAB" };

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ xero?: string }>;
}) {
  await requirePermission("integrations.manage");
  const statuses = await getIntegrationStatuses();
  const xero = await xeroStatus();
  const { xero: xeroResult } = await searchParams;

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect Xero and Dext. Credentials are encrypted before they're stored."
      />
      <IntegrationsClient statuses={statuses} xero={xero} xeroResult={xeroResult ?? null} />
    </div>
  );
}
