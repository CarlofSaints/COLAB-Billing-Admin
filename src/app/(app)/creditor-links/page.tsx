import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditorLinks, fixedLineItems, companies } from "@/db/schema";
import { requirePermission, getCurrentUser, hasPermission } from "@/lib/auth";
import { fetchContacts } from "@/lib/xero";
import { recoveryItemIds } from "@/lib/expense-accounts";
import { PageHeader } from "@/components/ui/page";
import { CreditorLinksClient } from "./creditor-links-client";

export const metadata = { title: "Creditor Links — COLAB" };
export const dynamic = "force-dynamic";

export default async function CreditorLinksPage() {
  await requirePermission("controls.view");
  const user = await getCurrentUser();
  const canManage = user ? hasPermission(user, "controls.manage") : false;

  // A link recovers SEVERAL items now, so the item name can no longer come
  // from a join on one id — the names are looked up from `items` below.
  const linkRows = await db
    .select({
      id: creditorLinks.id,
      xeroContactId: creditorLinks.xeroContactId,
      xeroContactName: creditorLinks.xeroContactName,
      fixedLineItemId: creditorLinks.fixedLineItemId,
      fixedLineItemIds: creditorLinks.fixedLineItemIds,
      balanceMethod: creditorLinks.balanceMethod,
      balanceCompanyId: creditorLinks.balanceCompanyId,
      balanceCompanyName: companies.name,
    })
    .from(creditorLinks)
    .leftJoin(companies, eq(companies.id, creditorLinks.balanceCompanyId))
    .orderBy(asc(creditorLinks.xeroContactName));

  const items = await db
    .select({ id: fixedLineItems.id, name: fixedLineItems.name })
    .from(fixedLineItems)
    .where(eq(fixedLineItems.active, true))
    .orderBy(asc(fixedLineItems.name));

  const nameOf = new Map(items.map((i) => [i.id, i.name]));
  const links = linkRows.map((l) => {
    const ids = recoveryItemIds(l);
    return {
      id: l.id,
      xeroContactId: l.xeroContactId,
      xeroContactName: l.xeroContactName,
      fixedLineItemIds: ids,
      // An id whose item is gone (or now inactive) is named as such rather
      // than silently dropped — it recovers nothing and inflates the overage.
      itemNames: ids.map((id) => nameOf.get(id) ?? `item ${id} (missing)`),
      balanceMethod: l.balanceMethod,
      balanceCompanyId: l.balanceCompanyId,
      balanceCompanyName: l.balanceCompanyName,
    };
  });

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
        description="Link a Xero creditor (landlord, ISP…) to the Static line item that already bills it. Its Xero bills are then ignored on the Variable run and reconciled against what was billed."
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
