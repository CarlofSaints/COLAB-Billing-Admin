"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Users, Plus, Pencil, Upload, Trash2, Search, Download } from "lucide-react";
import {
  createStaff,
  updateStaff,
  deleteStaff,
  importStaff,
  type ActionState,
  type ImportState,
} from "@/app/actions/staff";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";

type CompanyOpt = { id: number; name: string; type: "colab" | "sub" };
export type StaffRow = {
  id: number;
  firstName: string;
  lastName: string;
  cellNumber: string;
  email: string;
  position: string;
  companyId: number;
  companyName: string;
  active: boolean;
};

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function CompanySelect({ companies, defaultValue }: { companies: CompanyOpt[]; defaultValue?: number }) {
  const colab = companies.filter((c) => c.type === "colab");
  const subs = companies.filter((c) => c.type === "sub");
  return (
    <Select name="companyId" defaultValue={defaultValue ?? ""} required>
      <option value="" disabled>
        Select a company…
      </option>
      {colab.length > 0 && (
        <optgroup label="COLAB">
          {colab.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Sub-Companies">
        {subs.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}

function StaffForm({
  companies,
  person,
  onDone,
}: {
  companies: CompanyOpt[];
  person?: StaffRow;
  onDone: () => void;
}) {
  const action = person ? updateStaff : createStaff;
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      {person && <input type="hidden" name="id" value={person.id} />}
      <div className="grid grid-cols-2 gap-4">
        <Field label="First name">
          <Input name="firstName" defaultValue={person?.firstName} required autoFocus />
        </Field>
        <Field label="Surname">
          <Input name="lastName" defaultValue={person?.lastName} required />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Cell number">
          <Input name="cellNumber" defaultValue={person?.cellNumber} />
        </Field>
        <Field label="Email address">
          <Input name="email" type="email" defaultValue={person?.email} />
        </Field>
      </div>
      <Field label="Position (optional)">
        <Input name="position" defaultValue={person?.position} />
      </Field>
      <Field label="Company">
        <CompanySelect companies={companies} defaultValue={person?.companyId} />
      </Field>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SaveButton label={person ? "Save changes" : "Add staff member"} />
      </div>
    </form>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const [state, formAction] = useActionState<ImportState, FormData>(importStaff, {});
  const done = state.imported != null;

  return (
    <form action={formAction} className="space-y-4">
      <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-slate-700">Expected columns (headers, any order):</p>
          <a href="/api/staff/template" className="font-medium text-brand-700 hover:text-brand-800">
            Download template
          </a>
        </div>
        <p className="mt-1">Sub Company · Name · Surname · Email · Cell Number</p>
        <p className="mt-1 text-muted">
          <strong>Sub Company</strong> must match a company name exactly (COLAB or a sub-company).
          People are matched by email (or name + company) and <strong>updated in place</strong> — no
          duplicates. Rows with an unknown company are skipped.
        </p>
      </div>
      <Field label="Excel or CSV file">
        <Input name="file" type="file" accept=".xlsx,.xls,.csv" required />
      </Field>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {done && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <strong>{state.imported}</strong> added · <strong>{state.updated}</strong> updated
          (duplicates merged) · {state.skipped} skipped.
          {state.unknownCompanies && state.unknownCompanies.length > 0 && (
            <div className="mt-1 text-amber-700">
              Unmatched companies: {state.unknownCompanies.join(", ")}
            </div>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          {done ? "Close" : "Cancel"}
        </Button>
        {!done && <SaveButton label="Import" />}
      </div>
    </form>
  );
}

export function StaffManager({
  staff,
  companies,
  canManage,
}: {
  staff: StaffRow[];
  companies: CompanyOpt[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) =>
      [s.firstName, s.lastName, s.email, s.companyName, s.position]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [staff, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search staff…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/staff/template"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Download className="h-4 w-4" /> Template
            </a>
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" /> Import Excel
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add staff
            </Button>
          </div>
        )}
      </div>

      {staff.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="No staff yet"
          description="Add people manually or import a spreadsheet."
          action={canManage ? <Button onClick={() => setAdding(true)}>Add staff</Button> : undefined}
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Company</TH>
                <TH>Cell</TH>
                <TH>Email</TH>
                {canManage && <TH className="text-right">Actions</TH>}
              </tr>
            </THead>
            <tbody>
              {filtered.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <div className="font-medium text-slate-900">
                      {s.firstName} {s.lastName}
                    </div>
                    {s.position && <div className="text-xs text-muted">{s.position}</div>}
                  </TD>
                  <TD>
                    <Badge tone="brand">{s.companyName}</Badge>
                  </TD>
                  <TD>{s.cellNumber || "—"}</TD>
                  <TD>{s.email || "—"}</TD>
                  {canManage && (
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Remove ${s.firstName} ${s.lastName}?`)) deleteStaff(s.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {adding && (
        <Modal title="Add staff member" open onOpenChange={setAdding}>
          <StaffForm companies={companies} onDone={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal
          title={`Edit ${editing.firstName} ${editing.lastName}`}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        >
          <StaffForm companies={companies} person={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {importing && (
        <Modal title="Import staff from Excel" open onOpenChange={setImporting}>
          <ImportForm onDone={() => setImporting(false)} />
        </Modal>
      )}
    </div>
  );
}
