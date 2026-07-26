import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditorLinks, fixedLineItems, companies } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { fetchContacts } from "@/lib/xero";
import { PageHeader } from "@/components/ui/page";
import { CreditorLinksClient } from "./creditor-links-client";

export const metadata = { title: "Creditor Links — COLAB" };
export const dynamic = "force-dynamic";

export default async function CreditorLinksPage() {
  await requirePermission("controls.view");
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "controls.manage") : false;

  const links = await db
    .select({
      id: creditorLinks.id,
      xeroContactId: creditorLinks.xeroContactId,
      xeroContactName: creditorLinks.xeroContactName,
      fixedLineItemId: creditorLinks.fixedLineItemId,
      itemName: fixedLineItems.name,
      balanceMethod: creditorLinks.balanceMethod,
      balanceCompanyId: creditorLinks.balanceCompanyId,
      balanceCompanyName: companies.name,
    })
    .from(creditorLinks)
    .leftJoin(fixedLineItems, eq(fixedLineItems.id, creditorLinks.fixedLineItemId))
    .leftJoin(companies, eq(companies.id, creditorLinks.balanceCompanyId))
    .orderBy(asc(creditorLinks.xeroContactName));

  const items = await db
    .select({ id: fixedLineItems.id, name: fixedLineItems.name })
    .from(fixedLineItems)
    .where(eq(fixedLineItems.active, true))
    .orderBy(asc(fixedLineItems.name));

  const subCompanies = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(and(eq(companies.type, "sub"), eq(companies.active, true)))
    .orderBy(asc(companies.name));

  const contactsRes = await fetchContacts();
  const contacts = contactsRes.ok
    ? contactsRes.contacts.map((c) => ({ contactId: c.contactId, name: c.name }))
    : [];
  const contactsError = contactsRes.ok ? null : contactsRes.error;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Creditor Links"
        description="Link a Xero creditor (landlord, ISP…) to the recurring line item that already bills it. Its Xero bills are then ignored at month-end and reconciled against what was billed."
      />
      <CreditorLinksClient
        links={links}
        items={items}
        subCompanies={subCompanies}
        contacts={contacts}
        contactsError={contactsError}
        canManage={canManage}
      />
    </div>
  );
}
