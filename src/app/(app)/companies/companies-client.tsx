"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Building2, Plus, Pencil } from "lucide-react";
import { createCompany, updateCompany, type ActionState } from "@/app/actions/companies";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";

export type CompanyRow = {
  id: number;
  name: string;
  regNumber: string;
  vatNumber: string;
  registeredAddress: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
  active: boolean;
  staffCount: number;
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

export function CompaniesManager({
  companies,
  canManage,
}: {
  companies: CompanyRow[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CompanyRow | null>(null);

  return (
    <div className="space-y-4">
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
                <TH>Staff</TH>
                <TH>Status</TH>
                {canManage && <TH className="text-right">Actions</TH>}
              </tr>
            </THead>
            <tbody>
              {companies.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <div className="font-medium text-slate-900">{c.name}</div>
                    {c.contactEmail && <div className="text-xs text-muted">{c.contactEmail}</div>}
                  </TD>
                  <TD>{c.regNumber || "—"}</TD>
                  <TD>{c.vatNumber || "—"}</TD>
                  <TD>{c.staffCount}</TD>
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
    </div>
  );
}
