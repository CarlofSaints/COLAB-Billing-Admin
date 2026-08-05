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
  Wand2,
} from "lucide-react";
import {
  createStaff,
  updateStaff,
  deleteStaffWithHandover,
  importStaff,
  type ActionState,
  type DeleteStaffState,
  type ImportState,
} from "@/app/actions/staff";
import { inviteTeamMember, type InviteState } from "@/app/actions/team";
import {
  createGroupFromFilter,
  type ActionState as GroupActionState,
} from "@/app/actions/groups";
import { GroupRuleBuilder, type RuleCompany } from "@/components/group-rule-builder";
import type { GroupRule } from "@/lib/group-rules";
import { TagChip } from "@/components/tag-chip";
import { brandFor } from "@/lib/brands";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Field, Textarea } from "@/components/ui/field";
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
  /**
   * The EXTRA companies whose vehicles they may book. Their own company is
   * always allowed and never appears here.
   */
  vehicleCompanyIds: number[];
  tags: TagOption[];
};

/**
 * Turns the filter currently on the team list into a live email group.
 *
 * The filter is carried across pre-filled rather than just the resulting
 * people, because the group is the filter — tag someone Reception next month
 * and they join it without anyone revisiting this screen. The full rule
 * builder is shown so the filter can be widened here (gender, for instance,
 * which the list itself only reaches through free-text search).
 */
function SaveFilterAsGroup({
  seed,
  staff,
  tags,
  companies,
  genders,
  onDone,
}: {
  seed: GroupRule;
  staff: StaffRow[];
  tags: TagOption[];
  companies: RuleCompany[];
  genders: string[];
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<GroupActionState, FormData>(
    createGroupFromFilter,
    {},
  );
  const [rule, setRule] = useState<GroupRule>(seed);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Group name">
        <Input name="name" placeholder="e.g. Reception team" required autoFocus />
      </Field>
      <Field label="Description (optional)">
        <Textarea name="description" placeholder="What this group is for" />
      </Field>

      <GroupRuleBuilder
        rule={rule}
        onChange={setRule}
        staff={staff}
        tags={tags}
        companies={companies}
        genders={genders}
      />

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Create live group</Button>
      </div>
    </form>
  );
}

/**
 * Deleting a team member, one tag at a time.
 *
 * A tag isn't a label on a person, it's a job the office still needs doing —
 * Reception fills the desk rota, a costed tag bills per head. Letting the last
 * holder be deleted with a plain "are you sure?" drops that silently, and the
 * only symptom is a rota that won't populate or an invoice quietly R400 short.
 *
 * So each tag is decided separately: pass it on, or say "no thanks" out loud.
 * Nothing is deleted until every tag has an answer.
 */
function DeleteStaffDialog({
  person,
  staff,
  onDone,
}: {
  person: StaffRow;
  staff: StaffRow[];
  onDone: () => void;
}) {
  // tagId → recipient staff id, or null once "No thanks" is chosen.
  const [choice, setChoice] = useState<Map<number, number | null>>(new Map());
  const [queries, setQueries] = useState<Map<number, string>>(new Map());
  const [state, setState] = useState<DeleteStaffState>({});
  const [busy, setBusy] = useState(false);

  const others = useMemo(
    () => staff.filter((s) => s.id !== person.id && s.active),
    [staff, person.id],
  );

  const decided = person.tags.every((t) => choice.has(t.id));

  const pick = (tagId: number, staffId: number | null) =>
    setChoice((prev) => new Map(prev).set(tagId, staffId));

  const submit = async () => {
    setBusy(true);
    setState({});
    const res = await deleteStaffWithHandover(
      person.id,
      person.tags.map((t) => ({ tagId: t.id, toStaffId: choice.get(t.id) ?? null })),
    );
    setBusy(false);
    if (res.ok) onDone();
    else {
      setState(res);
      // Send them back to choosing for the tag that failed, rather than
      // leaving a rejected name sitting there looking accepted.
      if (res.tagId != null) {
        setChoice((prev) => {
          const next = new Map(prev);
          next.delete(res.tagId!);
          return next;
        });
      }
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        Remove <strong>{person.name}</strong> from the team list? This can’t be undone.
      </p>

      {person.tags.length === 0 ? (
        <p className="text-sm text-muted">They carry no tags, so nothing needs handing over.</p>
      ) : (
        <>
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              They hold <strong>{person.tags.length}</strong> tag
              {person.tags.length === 1 ? "" : "s"}. Decide what happens to each before they go —
              a tag nobody carries stops working silently.
            </span>
          </div>

          <div className="space-y-3">
            {person.tags.map((t) => {
              const chosen = choice.get(t.id);
              const answered = choice.has(t.id);
              const query = queries.get(t.id) ?? "";
              const q = query.trim().toLowerCase();
              // Anyone who already has it is shown but not selectable, so the
              // reason a name is missing is visible rather than mysterious.
              const candidates = others
                .filter((s) => !q || s.name.toLowerCase().includes(q) || s.companyName.toLowerCase().includes(q))
                .slice(0, 40);

              return (
                <div
                  key={t.id}
                  className={cn(
                    "rounded-lg border p-3",
                    answered ? "border-line bg-slate-50" : "border-amber-300 bg-white",
                  )}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <TagChip name={t.name} color={t.color} />
                    {t.costPerPerson != null && (
                      <span className="text-xs text-muted">
                        {formatCurrency(t.costPerPerson)} per month — moves with the tag
                      </span>
                    )}
                  </div>

                  {answered ? (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-slate-700">
                        {chosen == null ? (
                          <span className="text-muted">Letting this tag go.</span>
                        ) : (
                          <>
                            Passing to <strong>{others.find((s) => s.id === chosen)?.name}</strong>
                          </>
                        )}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setChoice((prev) => {
                            const next = new Map(prev);
                            next.delete(t.id);
                            return next;
                          })
                        }
                      >
                        Change
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          placeholder="Search for who takes it over…"
                          value={query}
                          onChange={(e) =>
                            setQueries((prev) => new Map(prev).set(t.id, e.target.value))
                          }
                          className="pl-9"
                        />
                      </div>
                      <div className="max-h-36 overflow-y-auto rounded-md border border-line">
                        {candidates.length === 0 && (
                          <p className="px-3 py-2 text-xs text-muted">Nobody matches that search.</p>
                        )}
                        {candidates.map((s) => {
                          const has = s.tags.some((x) => x.id === t.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              disabled={has}
                              onClick={() => pick(t.id, s.id)}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
                                has
                                  ? "cursor-not-allowed text-slate-400"
                                  : "text-slate-700 hover:bg-slate-50",
                              )}
                            >
                              <span>{s.name}</span>
                              <span className="text-xs text-muted">
                                {has ? "already has this tag" : s.companyName}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => pick(t.id, null)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        No thanks — nobody takes this one on
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={!decided || busy}>
          {busy ? "Removing…" : decided ? `Remove ${person.name}` : "Decide each tag first"}
        </Button>
      </div>
    </div>
  );
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function CompanySelect({
  companies,
  defaultValue,
  onChange,
}: {
  companies: CompanyOpt[];
  defaultValue?: number;
  onChange?: (id: number) => void;
}) {
  const colab = companies.filter((c) => c.type === "colab");
  const subs = companies.filter((c) => c.type === "sub");
  return (
    <Select
      name="companyId"
      defaultValue={defaultValue ?? ""}
      onChange={(e) => onChange?.(Number(e.target.value))}
      required
    >
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
  canGrantCrossCompany,
  vehicleCompanyOptions,
  onDone,
}: {
  companies: CompanyOpt[];
  allTags: TagOption[];
  person?: StaffRow;
  /** Directors only — see the field itself. */
  canGrantCrossCompany: boolean;
  /** The sub-companies that own vehicles. */
  vehicleCompanyOptions: { id: number; name: string }[];
  onDone: () => void;
}) {
  const action = person ? updateStaff : createStaff;
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const [selectedTags, setSelectedTags] = useState<number[]>(
    person ? person.tags.map((t) => t.id) : [],
  );
  const [vehicleCompanies, setVehicleCompanies] = useState<number[]>(
    person?.vehicleCompanyIds ?? [],
  );
  // Their own company follows the Company dropdown live, so changing it
  // re-labels which chip is the automatic one without a save in between.
  const [ownCompanyId, setOwnCompanyId] = useState(person?.companyId ?? 0);
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Gender">
          {/* UPPERCASE to match what's stored — see normaliseGender. When
              these read "Male" they couldn't match an imported "MALE", so the
              dropdown fell back to "—" and saving wiped the person's gender. */}
          <Select name="gender" defaultValue={(person?.gender ?? "").toUpperCase()}>
            <option value="">—</option>
            <option value="MALE">MALE</option>
            <option value="FEMALE">FEMALE</option>
            <option value="OTHER">OTHER</option>
          </Select>
        </Field>
        <Field label="Cell number">
          <Input name="cellNumber" defaultValue={person?.cellNumber} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
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
        <CompanySelect
          companies={companies}
          defaultValue={person?.companyId}
          onChange={setOwnCompanyId}
        />
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
      {/* Directors only. Everyone else doesn't get the input at all — and the
          server leaves the stored list alone rather than reading an absent
          picker as "clear it", so an Admin's save can't undo what a Director
          decided. */}
      {canGrantCrossCompany && vehicleCompanyOptions.length > 0 && (
        <Field
          label="Whose vehicles can they book?"
          hint="Their own company is always allowed. Add any others they drive for."
        >
          {vehicleCompanies
            .filter((id) => id !== ownCompanyId)
            .map((id) => (
              <input key={id} type="hidden" name="vehicleCompanyId" value={id} />
            ))}
          <div className="flex flex-wrap gap-1.5">
            {vehicleCompanyOptions.map((c) => {
              // Their own company can't be switched off, so it's shown as
              // already on and not as a choice — a chip you can untick but
              // that keeps working would be a lie.
              const isOwn = c.id === ownCompanyId;
              const on = isOwn || vehicleCompanies.includes(c.id);
              const brand = brandFor(c.name);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={isOwn}
                  title={isOwn ? "Their own company — always allowed" : undefined}
                  onClick={() =>
                    setVehicleCompanies((prev) =>
                      prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                    )
                  }
                  style={
                    on ? { backgroundColor: `${brand.color}1f`, borderColor: brand.color } : undefined
                  }
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    on ? "text-slate-900" : "border-line text-slate-500 hover:bg-slate-50",
                    isOwn && "cursor-default opacity-90",
                  )}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: brand.color, opacity: on ? 1 : 0.4 }}
                  />
                  {c.name}
                  {isOwn && <span className="text-[10px] text-muted">(own)</span>}
                </button>
              );
            })}
          </div>
        </Field>
      )}
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
  canManageGroups,
  canGrantCrossCompany,
  vehicleCompanyOptions,
}: {
  staff: StaffRow[];
  companies: CompanyOpt[];
  allTags: TagOption[];
  /** The sub-companies that own vehicles, for the cross-company picker. */
  vehicleCompanyOptions: { id: number; name: string }[];
  canManage: boolean;
  canInvite: boolean;
  /** `groups.manage` — gates turning the current filter into an email group. */
  canManageGroups: boolean;
  /** `vehicles.crosscompany.grant` — Directors only; gates the vehicle tickbox. */
  canGrantCrossCompany: boolean;
}) {
  const showActions = canManage || canInvite;
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState<"all" | number>("all");
  // Tag ids to filter by. Several at once narrows — someone must carry all of
  // them — because "Reception AND Admin" is the question people actually ask;
  // "anyone with either" is what the unfiltered list already shows.
  const [tagFilter, setTagFilter] = useState<number[]>([]);
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [deleting, setDeleting] = useState<StaffRow | null>(null);

  // The filter on screen, in the shape a live group stores.
  const filterAsRule: GroupRule = useMemo(
    () => ({
      companyId: companyFilter === "all" ? null : companyFilter,
      tagIds: tagFilter,
      untaggedOnly,
      gender: null,
      includeInBilling: null,
      search: query.trim() || null,
    }),
    [companyFilter, tagFilter, untaggedOnly, query],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((s) => {
      if (companyFilter !== "all" && s.companyId !== companyFilter) return false;
      if (untaggedOnly && s.tags.length > 0) return false;
      if (tagFilter.length > 0) {
        const mine = new Set(s.tags.map((t) => t.id));
        if (!tagFilter.every((id) => mine.has(id))) return false;
      }
      if (!q) return true;
      return [s.name, s.email, s.companyName, s.position, s.gender, ...s.tags.map((t) => t.name)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [staff, query, companyFilter, tagFilter, untaggedOnly]);

  const toggleTagFilter = (id: number) => {
    setUntaggedOnly(false);
    setTagFilter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // How many people each tag would leave, given the other filters already on —
  // so a chip that would empty the list says so before it's clicked.
  const tagCounts = useMemo(() => {
    const base = staff.filter(
      (s) => companyFilter === "all" || s.companyId === companyFilter,
    );
    const counts = new Map<number, number>();
    for (const s of base) for (const t of s.tags) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
    return counts;
  }, [staff, companyFilter]);

  const untaggedCount = useMemo(
    () =>
      staff.filter(
        (s) => (companyFilter === "all" || s.companyId === companyFilter) && s.tags.length === 0,
      ).length,
    [staff, companyFilter],
  );

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

  // Genders actually recorded — a free-text column, so a fixed list would
  // quietly exclude whatever else has been typed in.
  const genderOptions = useMemo(
    () => Array.from(new Set(staff.map((s) => (s.gender ?? "").trim()).filter(Boolean))).sort(),
    [staff],
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
          {(tagFilter.length > 0 || untaggedOnly) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTagFilter([]);
                setUntaggedOnly(false);
              }}
            >
              Clear tags
            </Button>
          )}
          <span className="text-sm text-muted">
            {filtered.length} of {staff.length}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageGroups && (
            <Button variant="outline" onClick={() => setSavingGroup(true)}>
              <Wand2 className="h-4 w-4" /> Save filter as group
            </Button>
          )}
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

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted">
            Tags
          </span>
          {allTags.map((t) => {
            const on = tagFilter.includes(t.id);
            const count = tagCounts.get(t.id) ?? 0;
            // A tag nobody in the current view carries is shown but faded —
            // hiding it would make the row jump around as you filter.
            return (
              <TagChip
                key={t.id}
                name={`${t.name} ${count}`}
                color={t.color}
                selected={on}
                onClick={count === 0 && !on ? undefined : () => toggleTagFilter(t.id)}
                className={count === 0 && !on ? "opacity-40" : undefined}
              />
            );
          })}
          {untaggedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setTagFilter([]);
                setUntaggedOnly((v) => !v);
              }}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                untaggedOnly
                  ? "border-slate-700 bg-slate-700 text-white"
                  : "border-line text-slate-500 hover:bg-slate-50",
              )}
              title="People carrying no tags at all"
            >
              Untagged {untaggedCount}
            </button>
          )}
          {tagFilter.length > 1 && (
            <span className="text-xs text-muted">
              — showing people with <strong>all</strong> of these
            </span>
          )}
        </div>
      )}

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
                            <Button variant="ghost" size="sm" onClick={() => setDeleting(s)}>
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
          <StaffForm
            companies={companies}
            allTags={allTags}
            canGrantCrossCompany={canGrantCrossCompany}
            vehicleCompanyOptions={vehicleCompanyOptions}
            onDone={() => setAdding(false)}
          />
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
            canGrantCrossCompany={canGrantCrossCompany}
            vehicleCompanyOptions={vehicleCompanyOptions}
            onDone={() => setEditing(null)}
          />
        </Modal>
      )}
      {importing && (
        <Modal title="Import team members from Excel" open onOpenChange={setImporting}>
          <ImportForm onDone={() => setImporting(false)} />
        </Modal>
      )}
      {deleting && (
        <Modal
          title={`Remove ${deleting.name}`}
          open
          onOpenChange={(o) => !o && setDeleting(null)}
        >
          <DeleteStaffDialog
            person={deleting}
            staff={staff}
            onDone={() => setDeleting(null)}
          />
        </Modal>
      )}
      {savingGroup && (
        <Modal
          title="Save this filter as an email group"
          description="The group stays in step with the filter — anyone who starts matching later is included automatically."
          open
          onOpenChange={(o) => !o && setSavingGroup(false)}
          wide
        >
          <SaveFilterAsGroup
            seed={filterAsRule}
            staff={staff}
            tags={allTags}
            companies={companyOptions}
            genders={genderOptions}
            onDone={() => setSavingGroup(false)}
          />
        </Modal>
      )}
    </div>
  );
}
