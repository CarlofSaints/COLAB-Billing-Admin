"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Pencil, Trash2, Link2, ArrowRight, TriangleAlert } from "lucide-react";
import {
  createCreditorLink,
  updateCreditorLink,
  deleteCreditorLink,
  type LinkState,
} from "@/app/actions/creditor-links";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";

type Contact = { contactId: string; name: string };
type Item = { id: number; name: string };
type Company = { id: number; name: string };
type LinkRow = {
  id: number;
  xeroContactId: string;
  xeroContactName: string;
  fixedLineItemId: number;
  itemName: string | null;
  balanceMethod: string | null;
  balanceCompanyId: number | null;
  balanceCompanyName: string | null;
};

const BALANCE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Flag only — don't bill the overage" },
  { value: "per_sqm", label: "Split per m²" },
  { value: "headcount", label: "Split per head" },
  { value: "equal", label: "Split equally" },
  { value: "direct", label: "Direct to one company" },
];

function balanceLabel(link: LinkRow): string {
  if (!link.balanceMethod) return "Flag overage";
  if (link.balanceMethod === "direct") return `Overage → ${link.balanceCompanyName ?? "a company"}`;
  return `Overage: ${BALANCE_OPTIONS.find((b) => b.value === link.balanceMethod)?.label ?? link.balanceMethod}`;
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function LinkForm({
  link,
  items,
  subCompanies,
  availableContacts,
  onDone,
}: {
  link?: LinkRow;
  items: Item[];
  subCompanies: Company[];
  availableContacts: Contact[];
  onDone: () => void;
}) {
  const editing = !!link;
  const [state, action] = useActionState<LinkState, FormData>(
    editing ? updateCreditorLink : createCreditorLink,
    {},
  );
  const [contactId, setContactId] = useState(link?.xeroContactId ?? "");
  const [method, setMethod] = useState(link?.balanceMethod ?? "");

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const contactName =
    availableContacts.find((c) => c.contactId === contactId)?.name ?? link?.xeroContactName ?? "";

  return (
    <form action={action} className="space-y-4">
      {editing && <input type="hidden" name="id" value={link.id} />}

      {editing ? (
        <Field label="Creditor">
          <div className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
            {link.xeroContactName}
          </div>
        </Field>
      ) : (
        <Field label="Creditor (Xero contact)">
          <Select value={contactId} onChange={(e) => setContactId(e.target.value)} required>
            <option value="" disabled>
              Choose a creditor…
            </option>
            {availableContacts.map((c) => (
              <option key={c.contactId} value={c.contactId}>
                {c.name}
              </option>
            ))}
          </Select>
          <input type="hidden" name="xeroContactId" value={contactId} />
          <input type="hidden" name="xeroContactName" value={contactName} />
        </Field>
      )}

      <Field label="Billed by this recurring line item" hint="What already recovers this cost up front.">
        <Select name="fixedLineItemId" defaultValue={link?.fixedLineItemId ?? ""} required>
          <option value="" disabled>
            Choose a recurring item…
          </option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="If Xero is more than what was billed…"
        hint="How to split the overage onto the month-end invoice."
      >
        <Select
          name="balanceMethod"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          {BALANCE_OPTIONS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </Select>
      </Field>

      {method === "direct" && (
        <Field label="Overage goes to">
          <Select name="balanceCompanyId" defaultValue={link?.balanceCompanyId ?? ""} required>
            <option value="" disabled>
              Choose a company…
            </option>
            {subCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {state.error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="h-4 w-4" /> {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SaveButton label={editing ? "Save changes" : "Link creditor"} />
      </div>
    </form>
  );
}

function RowActions({
  link,
  items,
  subCompanies,
}: {
  link: LinkRow;
  items: Item[];
  subCompanies: Company[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-1">
      <Modal
        title="Edit creditor link"
        open={editing}
        onOpenChange={setEditing}
        trigger={
          <Button variant="ghost" size="sm" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        }
      >
        <LinkForm
          link={link}
          items={items}
          subCompanies={subCompanies}
          availableContacts={[]}
          onDone={() => setEditing(false)}
        />
      </Modal>
      <Button
        variant="ghost"
        size="sm"
        title="Remove"
        disabled={pending}
        onClick={() => {
          if (confirm(`Unlink ${link.xeroContactName}?`)) start(() => deleteCreditorLink(link.id));
        }}
      >
        <Trash2 className="h-3.5 w-3.5 text-red-500" />
      </Button>
    </div>
  );
}

export function CreditorLinksClient({
  links,
  items,
  subCompanies,
  contacts,
  contactsError,
  canManage,
}: {
  links: LinkRow[];
  items: Item[];
  subCompanies: Company[];
  contacts: Contact[];
  contactsError: string | null;
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const linkedIds = useMemo(() => new Set(links.map((l) => l.xeroContactId)), [links]);
  const availableContacts = useMemo(
    () => contacts.filter((c) => !linkedIds.has(c.contactId)),
    [contacts, linkedIds],
  );

  return (
    <div className="space-y-4">
      {contactsError && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="h-4 w-4 shrink-0" /> Couldn&apos;t load Xero contacts ({contactsError}).
          You can still see existing links, but adding a new one needs Xero connected.
        </p>
      )}

      {canManage && (
        <div className="flex justify-end">
          <Modal
            title="Link a creditor"
            open={adding}
            onOpenChange={setAdding}
            trigger={
              <Button disabled={items.length === 0 || availableContacts.length === 0}>
                <Plus className="h-4 w-4" /> Link creditor
              </Button>
            }
          >
            <LinkForm
              items={items}
              subCompanies={subCompanies}
              availableContacts={availableContacts}
              onDone={() => setAdding(false)}
            />
          </Modal>
        </div>
      )}

      {items.length === 0 && (
        <p className="text-sm text-muted">
          Create a recurring fixed line item first (under Controls), then link a creditor to it.
        </p>
      )}

      {links.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-8 w-8" />}
          title="No creditor links yet"
          description="Link a creditor whose cost you already bill up front (e.g. the landlord) so it isn't billed again at month-end."
        />
      ) : (
        <Card className="divide-y divide-line">
          {links.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-medium text-slate-900">{l.xeroContactName}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                <Badge tone="amber">{l.itemName ?? "—"}</Badge>
                <Badge tone="neutral">{balanceLabel(l)}</Badge>
              </div>
              {canManage && <RowActions link={l} items={items} subCompanies={subCompanies} />}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
