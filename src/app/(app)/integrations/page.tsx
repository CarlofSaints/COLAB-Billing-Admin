import { requirePermission } from "@/lib/auth";
import { getIntegrationStatuses } from "@/lib/integrations";
import { PageHeader } from "@/components/ui/page";
import { IntegrationsClient } from "./integrations-client";

export const metadata = { title: "Integrations — COLAB" };

export default async function IntegrationsPage() {
  await requirePermission("integrations.manage");
  const statuses = await getIntegrationStatuses();

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect Xero and Dext. Credentials are encrypted before they're stored."
      />
      <IntegrationsClient statuses={statuses} />
    </div>
  );
}
