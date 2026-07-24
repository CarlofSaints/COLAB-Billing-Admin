"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Building2,
  Plus,
  Pencil,
  Link2,
  Link2Off,
  Search,
  TriangleAlert,
  Sparkles,
} from "lucide-react";
import {
  createCompany,
  updateCompany,
  setXeroContact,
  type ActionState,
} from "@/app/actions/companies";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type CompanyRow = {
  id: number;
  name: string;
  regNumber: string;
  vatNumber: string;
  registeredAddress: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactName2: string;
  contactEmail2: string;
  contactName3: string;
  contactEmail3: string;
  notes: string;
  active: boolean;
  staffCount: number;
  xeroContactId: string | null;
  xeroContactName: string | null;
};

export type XeroContactOption = {
  contactId: string;
  name: string;
  email: string | null;
  isCustomer: boolean;
};

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function CompanyForm({ company, onDone }: { company?: CompanyRow; onDone: () => void }) {
  const action = company ? updateCompany : createCompany;
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      {company && <input type="hidden" name="id" value={company.id} />}
      <Field label="Company name">
        <Input name="name" defaultValue={company?.name} required autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Registration number">
          <Input name="regNumber" defaultValue={company?.regNumber} />
        </Field>
        <Field label="VAT number">
          <Input name="vatNumber" defaultValue={company?.vatNumber} />
        </Field>
      </div>
      <Field label="Registered address">
        <Textarea name="registeredAddress" defaultValue={company?.registeredAddress} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Billing contact name">
          <Input name="contactName" defaultValue={company?.contactName} />
        </Field>
        <Field label="Billing contact phone">
          <Input name="contactPhone" defaultValue={company?.contactPhone} />
        </Field>
      </div>
      <Field label="Billing contact email">
        <Input name="contactEmail" type="email" defaultValue={company?.contactEmail} />
      </Field>

      <div className="rounded-lg border border-line p-3">
        <p className="text-sm font-medium text-slate-700">Additional contacts</p>
        <p className="mb-3 text-xs text-muted">
          Scheduled reminders go to every contact listed here, each addressed by name.
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Second contact name">
              <Input name="contactName2" defaultValue={company?.contactName2} />
            </Field>
            <Field label="Second contact email">
              <Input name="contactEmail2" type="email" defaultValue={company?.contactEmail2} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Third contact name">
              <Input name="contactName3" defaultValue={company?.contactName3} />
            </Field>
            <Field label="Third contact email">
              <Input name="contactEmail3" type="email" defaultValue={company?.contactEmail3} />
            </Field>
          </div>
        </div>
      </div>
      <Field label="Notes">
        <Textarea name="notes" defaultValue={company?.notes} />
      </Field>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SaveButton label={company ? "Save changes" : "Create company"} />
      </div>
    </form>
  );
}

/** Loose match used only to suggest a likely Xero contact — never to auto-link. */
function suggestionScore(companyName: string, contactName: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\(pty\)|\bltd\b|\binc\b|\bcc\b|[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const a = norm(companyName);
  const b = norm(contactName);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.startsWith(a) || a.startsWith(b)) return 80;
  if (b.includes(a) || a.includes(b)) return 60;
  // Initials: "iRam" against "Innovative Retail Account Management".
  const initials = b
    .split(" ")
    .map((w) => w[0])
    .join("");
  if (initials.startsWith(a.replace(/ /g, ""))) return 55;
  const wordsA = a.split(" ");
  const shared = wordsA.filter((w) => w.length > 2 && b.includes(w)).length;
  return shared > 0 ? 20 + shared * 10 : 0;
}

function XeroContactPicker({
  company,
  contacts,
  onDone,
}: {
  company: CompanyRow;
  contacts: XeroContactOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ranked = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scored = contacts.map((c) => ({ ...c, score: suggestionScore(company.name, c.name) }));
    const filtered = q
      ? scored.filter(
          (c) => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q),
        )
      : scored;
    return [...filtered].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }, [contacts, company.name, query]);

  const link = async (contact: XeroContactOption | null) => {
    setBusy(true);
    setError(null);
    const res = await setXeroContact(
      company.id,
      contact?.contactId ?? null,
      contact?.name ?? null,
    );
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
    onDone();
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Pick the Xero contact that <span className="font-medium text-slate-700">{company.name}</span>
        &apos;s invoices should be raised against.
      </p>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Search Xero contacts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          autoFocus
        />
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="h-4 w-4" /> {error}
        </p>
      )}

      <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
        {ranked.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">No contacts match that search.</p>
        )}
        {ranked.slice(0, 60).map((c) => {
          const selected = c.contactId === company.xeroContactId;
          return (
            <button
              key={c.contactId}
              type="button"
              disabled={busy}
              onClick={() => link(c)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-slate-50",
                selected && "bg-brand-50",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-800">{c.name}</span>
                {c.email && <span className="block truncate text-xs text-muted">{c.email}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {c.score >= 55 && !selected && (
                  <Badge tone="brand">
                    <Sparkles className="mr-1 h-3 w-3" /> Likely
                  </Badge>
                )}
                {c.isCustomer && <Badge tone="neutral">Customer</Badge>}
                {selected && <Badge tone="green">Linked</Badge>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex justify-between gap-2 pt-1">
        {company.xeroContactId ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => link(null)}>
            <Link2Off className="h-4 w-4" /> Unlink
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" variant="outline" onClick={onDone}>
          Close
        </Button>
      </div>
    </div>
  );
}

export function CompaniesManager({
  companies,
  canManage,
  xeroContacts,
  xeroError,
}: {
  companies: CompanyRow[];
  canManage: boolean;
  xeroContacts: XeroContactOption[];
  xeroError: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CompanyRow | null>(null);
  const [linking, setLinking] = useState<CompanyRow | null>(null);

  const unlinked = companies.filter((c) => c.active && !c.xeroContactId);

  return (
    <div className="space-y-4">
      {unlinked.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {unlinked.length} sub-compan{unlinked.length === 1 ? "y isn't" : "ies aren't"} linked to
            a Xero contact ({unlinked.map((c) => c.name).join(", ")}). Invoices can&apos;t be raised
            for them until they are.
          </div>
        </div>
      )}

      {xeroError && (
        <div className="flex items-start gap-3 rounded-lg border border-line bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Couldn&apos;t load Xero contacts ({xeroError}). Existing links are still shown.
        </div>
      )}

      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add sub-company
          </Button>
        </div>
      )}

      {companies.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="No sub-companies yet"
          description="Add the businesses that COLAB bills each month."
          action={
            canManage ? <Button onClick={() => setAdding(true)}>Add sub-company</Button> : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>Company</TH>
                <TH>Reg no.</TH>
                <TH>VAT no.</TH>
                <TH>Team</TH>
                <TH>Xero contact</TH>
                <TH>Status</TH>
                {canManage && <TH className="text-right">Actions</TH>}
              </tr>
            </THead>
            <tbody>
              {companies.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <div className="font-medium text-slate-900">{c.name}</div>
                    {c.contactEmail && (
                      <div className="text-xs text-muted">
                        {c.contactEmail}
                        {(() => {
                          const extra = [c.contactEmail2, c.contactEmail3].filter(Boolean).length;
                          return extra > 0 ? ` +${extra} more` : "";
                        })()}
                      </div>
                    )}
                  </TD>
                  <TD>{c.regNumber || "—"}</TD>
                  <TD>{c.vatNumber || "—"}</TD>
                  <TD>{c.staffCount}</TD>
                  <TD>
                    {c.xeroContactId ? (
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => setLinking(c)}
                        className="group flex items-center gap-1.5 text-left text-sm text-slate-700 disabled:cursor-default"
                      >
                        <Link2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="max-w-[13rem] truncate group-hover:underline">
                          {c.xeroContactName ?? "Linked"}
                        </span>
                      </button>
                    ) : canManage ? (
                      <Button variant="outline" size="sm" onClick={() => setLinking(c)}>
                        <Link2 className="h-3.5 w-3.5" /> Link
                      </Button>
                    ) : (
                      <Badge tone="amber">Not linked</Badge>
                    )}
                  </TD>
                  <TD>
                    {c.active ? (
                      <Badge tone="green">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                  </TD>
                  {canManage && (
                    <TD className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {adding && (
        <Modal title="Add sub-company" open onOpenChange={setAdding} wide>
          <CompanyForm onDone={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal
          title={`Edit ${editing.name}`}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          wide
        >
          <CompanyForm company={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {linking && (
        <Modal
          title={`Xero contact — ${linking.name}`}
          open
          onOpenChange={(o) => !o && setLinking(null)}
          wide
        >
          <XeroContactPicker
            company={linking}
            contacts={xeroContacts}
            onDone={() => setLinking(null)}
          />
        </Modal>
      )}
    </div>
  );
}
