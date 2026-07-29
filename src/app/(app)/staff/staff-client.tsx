"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Users,
  Plus,
  Pencil,
  Upload,
  Trash2,
  Search,
  Download,
  FileSpreadsheet,
  UserPlus,
  CheckCircle2,
  TriangleAlert,
} from "lucide-react";
import {
  createStaff,
  updateStaff,
  deleteStaff,
  importStaff,
  type ActionState,
  type ImportState,
} from "@/app/actions/staff";
import { inviteTeamMember, type InviteState } from "@/app/actions/team";
import { TagChip } from "@/components/tag-chip";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TH, SortableTH, TR, TD } from "@/components/ui/table";
import { useTableSort } from "@/lib/use-table-sort";

type CompanyOpt = { id: number; name: string; type: "colab" | "sub" };
type TagOption = {
  id: number;
  name: string;
  color: string | null;
  /** Set on a billable tag — what applying it costs the person's company. */
  costPerPerson?: number | null;
};
export type StaffRow = {
  id: number;
  name: string;
  cellNumber: string;
  email: string;
  gender: string;
  position: string;
  companyId: number;
  companyName: string;
  active: boolean;
  includeInBilling: boolean;
  hasAccount: boolean;
  /** What the person set on My Profile — read-only here, and it always wins. */
  dateOfBirthSelf: string | null;
  /** The admin's stand-in, used only while the person hasn't set their own. */
  dateOfBirthAdmin: string | null;
  tags: TagOption[];
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
  allTags,
  person,
  onDone,
}: {
  companies: CompanyOpt[];
  allTags: TagOption[];
  person?: StaffRow;
  onDone: () => void;
}) {
  const action = person ? updateStaff : createStaff;
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const [selectedTags, setSelectedTags] = useState<number[]>(
    person ? person.tags.map((t) => t.id) : [],
  );
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const toggleTag = (id: number) =>
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <form action={formAction} className="space-y-4">
      {person && <input type="hidden" name="id" value={person.id} />}
      <Field label="Name">
        <Input name="name" defaultValue={person?.name} required autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Gender">
          <Select name="gender" defaultValue={person?.gender ?? ""}>
            <option value="">—</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </Select>
        </Field>
        <Field label="Cell number">
          <Input name="cellNumber" defaultValue={person?.cellNumber} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Email address">
          <Input name="email" type="email" defaultValue={person?.email} />
        </Field>
        <Field label="Position (optional)">
          <Input name="position" defaultValue={person?.position} />
        </Field>
      </div>
      <Field
        label="Date of birth"
        hint={
          person?.dateOfBirthSelf
            ? "They've set this themselves on My Profile, so it's theirs to change — anything entered here is ignored while that stands."
            : "For the birthday list on the Team Dashboard. If they later fill it in on My Profile, their own answer takes over."
        }
      >
        <Input
          name="dateOfBirthAdmin"
          type="date"
          defaultValue={person?.dateOfBirthAdmin ?? ""}
          disabled={!!person?.dateOfBirthSelf}
          className="max-w-52"
        />
      </Field>
      {person?.dateOfBirthSelf && (
        <p className="-mt-2 text-xs text-muted">
          Set by {person.name.split(" ")[0]}: <strong>{person.dateOfBirthSelf}</strong>
        </p>
      )}
      <Field label="Company">
        <CompanySelect companies={companies} defaultValue={person?.companyId} />
      </Field>
      <Field
        label="Include in Billing"
        hint="Only people set to Yes count towards the headcount that shared costs are split by."
      >
        <Select
          name="includeInBilling"
          defaultValue={person ? (person.includeInBilling ? "Yes" : "No") : "Yes"}
        >
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </Select>
      </Field>
      <Field
        label="Tags"
        hint={
          allTags.length
            ? "Click to add or remove. A tag showing an amount is billable — adding it charges this person's sub-company that much a month."
            : undefined
        }
      >
        {allTags.length === 0 ? (
          <p className="text-sm text-muted">No tags yet — create some on the Tags page.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((t) => (
              <TagChip
                key={t.id}
                name={
                  t.costPerPerson != null ? `${t.name} · ${formatCurrency(t.costPerPerson)}` : t.name
                }
                color={t.color}
                selected={selectedTags.includes(t.id)}
                onClick={() => toggleTag(t.id)}
              />
            ))}
          </div>
        )}
        {selectedTags.map((id) => (
          <input key={id} type="hidden" name="tagId" value={id} />
        ))}
      </Field>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SaveButton label={person ? "Save changes" : "Add team member"} />
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
        <p className="mt-1">Sub Company · Name · Gender · Email · Cell Number</p>
        <p className="mt-1 text-muted">
          Only <strong>Name</strong> and <strong>Sub Company</strong> are required — any other field
          can be blank. <strong>Sub Company</strong> must match a company name exactly (COLAB or a
          sub-company). People are matched by email (or name + company) and{" "}
          <strong>updated in place</strong> — no duplicates. Rows with no name or an unknown company
          are skipped and counted.
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

function InviteButton({ person }: { person: StaffRow }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<InviteState | null>(null);

  async function run() {
    setPending(true);
    const r = await inviteTeamMember(person.id);
    setResult(r);
    setPending(false);
  }

  return (
    <Modal
      title="Invite to the hub"
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setResult(null);
      }}
      trigger={
        <Button variant="ghost" size="sm" title="Create a hub login">
          <UserPlus className="h-3.5 w-3.5" />
        </Button>
      }
    >
      <div className="space-y-4">
        {!result?.ok ? (
          <>
            <p className="text-sm text-slate-600">
              Create a hub login for <strong>{person.name}</strong> ({person.email})? They&apos;ll
              get an email with a link to set up their profile.
            </p>
            {result?.error && (
              <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <TriangleAlert className="h-4 w-4" /> {result.error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={run} disabled={pending}>
                {pending ? "Creating…" : "Create login"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {result.emailed
                ? `Invited — email sent to ${result.emailTo}.`
                : "Login created."}
            </p>
            {!result.emailed && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <p className="text-slate-600">
                  {result.emailError} Share this temporary password with them:
                </p>
                <code className="mt-1 block font-mono text-base font-semibold text-slate-900">
                  {result.tempPassword}
                </code>
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function StaffManager({
  staff,
  companies,
  allTags,
  canManage,
  canInvite,
}: {
  staff: StaffRow[];
  companies: CompanyOpt[];
  allTags: TagOption[];
  canManage: boolean;
  canInvite: boolean;
}) {
  const showActions = canManage || canInvite;
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState<"all" | number>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((s) => {
      if (companyFilter !== "all" && s.companyId !== companyFilter) return false;
      if (!q) return true;
      return [s.name, s.email, s.companyName, s.position, s.gender]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [staff, query, companyFilter]);

  const { sorted, sort, toggle } = useTableSort(
    filtered,
    {
      name: (s) => s.name,
      company: (s) => s.companyName,
      gender: (s) => s.gender,
      cell: (s) => s.cellNumber,
      email: (s) => s.email,
      billing: (s) => (s.includeInBilling ? "Yes" : "No"),
    },
    { key: "name", dir: "asc" },
  );

  // Only offer companies that actually have someone in the list.
  const companyOptions = useMemo(() => {
    const withStaff = new Set(staff.map((s) => s.companyId));
    return companies.filter((c) => withStaff.has(c.id));
  }, [companies, staff]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Search team members…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select
            className="w-52"
            value={companyFilter}
            onChange={(e) =>
              setCompanyFilter(e.target.value === "all" ? "all" : Number(e.target.value))
            }
          >
            <option value="all">All companies</option>
            {companyOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <span className="text-sm text-muted">
            {filtered.length} of {staff.length}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Exporting is a read, so anyone who can see the list can take it. */}
          <a
            href="/api/staff/export"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            title="Every field, plus a 1/0 column per tag"
          >
            <FileSpreadsheet className="h-4 w-4" /> Export to Excel
          </a>
          {canManage && (
            <>
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
                <Plus className="h-4 w-4" /> Add team member
              </Button>
            </>
          )}
        </div>
      </div>

      {staff.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="No team members yet"
          description="Add people manually or import a spreadsheet."
          action={canManage ? <Button onClick={() => setAdding(true)}>Add team member</Button> : undefined}
        />
      ) : (
        <Card>
          <Table sticky>
            <THead sticky>
              <tr>
                <SortableTH sortKey="name" sort={sort} onSort={toggle}>
                  Name
                </SortableTH>
                <SortableTH sortKey="company" sort={sort} onSort={toggle}>
                  Company
                </SortableTH>
                <SortableTH sortKey="gender" sort={sort} onSort={toggle}>
                  Gender
                </SortableTH>
                <SortableTH sortKey="cell" sort={sort} onSort={toggle}>
                  Cell
                </SortableTH>
                <SortableTH sortKey="email" sort={sort} onSort={toggle}>
                  Email
                </SortableTH>
                <SortableTH sortKey="billing" sort={sort} onSort={toggle}>
                  In billing
                </SortableTH>
                {showActions && <TH className="text-right">Actions</TH>}
              </tr>
            </THead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <TD colSpan={showActions ? 7 : 6} className="py-10 text-center text-sm text-muted">
                    No team members match this search or filter.
                  </TD>
                </tr>
              )}
              {sorted.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <div className="font-medium text-slate-900">{s.name}</div>
                    {s.position && <div className="text-xs text-muted">{s.position}</div>}
                    {s.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.tags.map((t) => (
                          <TagChip key={t.id} name={t.name} color={t.color} />
                        ))}
                      </div>
                    )}
                  </TD>
                  <TD>
                    <Badge tone="brand">{s.companyName}</Badge>
                  </TD>
                  <TD>{s.gender || "—"}</TD>
                  <TD>{s.cellNumber || "—"}</TD>
                  <TD>{s.email || "—"}</TD>
                  <TD>
                    {s.includeInBilling ? (
                      <Badge tone="green">Yes</Badge>
                    ) : (
                      <Badge tone="amber">No</Badge>
                    )}
                  </TD>
                  {showActions && (
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {s.hasAccount ? (
                          <Badge tone="indigo">Hub user</Badge>
                        ) : (
                          canInvite &&
                          s.email && <InviteButton person={s} />
                        )}
                        {canManage && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (confirm(`Remove ${s.name}?`)) deleteStaff(s.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </>
                        )}
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
        <Modal title="Add team member" open onOpenChange={setAdding}>
          <StaffForm companies={companies} allTags={allTags} onDone={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal
          title={`Edit ${editing.name}`}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        >
          <StaffForm
            companies={companies}
            allTags={allTags}
            person={editing}
            onDone={() => setEditing(null)}
          />
        </Modal>
      )}
      {importing && (
        <Modal title="Import team members from Excel" open onOpenChange={setImporting}>
          <ImportForm onDone={() => setImporting(false)} />
        </Modal>
      )}
    </div>
  );
}
