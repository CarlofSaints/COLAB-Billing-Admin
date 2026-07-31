"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Mails, Plus, Pencil, Trash2, Users2, Search, Wand2 } from "lucide-react";
import {
  createGroup,
  updateGroup,
  deleteGroup,
  saveGroupMembers,
  type ActionState,
} from "@/app/actions/groups";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import {
  GroupRuleBuilder,
  type RuleCompany,
  type RuleStaff,
  type RuleTag,
} from "@/components/group-rule-builder";
import { EMPTY_RULE, describeRule, type GroupRule } from "@/lib/group-rules";
import { cn } from "@/lib/utils";

type StaffOpt = RuleStaff & { email: string };
type GroupRow = {
  id: number;
  name: string;
  description: string;
  memberIds: number[];
  memberCount: number;
  /** Who's actually in it right now — resolved server-side, already sorted. */
  members: GroupMemberRow[];
  /** Set = the group is a saved filter, re-evaluated every time it's used. */
  rule: GroupRule | null;
};

type GroupMemberRow = {
  staffId: number;
  name: string;
  email: string;
  companyName: string;
};

function GroupForm({
  group,
  staff,
  tags,
  companies,
  genders,
  onDone,
}: {
  group?: GroupRow;
  staff: StaffOpt[];
  tags: RuleTag[];
  companies: RuleCompany[];
  genders: string[];
  onDone: () => void;
}) {
  const action = group ? updateGroup : createGroup;
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const [live, setLive] = useState(group ? group.rule != null : false);
  const [rule, setRule] = useState<GroupRule>(group?.rule ?? EMPTY_RULE);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      {group && <input type="hidden" name="id" value={group.id} />}
      {!live && <input type="hidden" name="membership" value="list" />}
      <Field label="Group name">
        <Input name="name" defaultValue={group?.name} placeholder="e.g. Everyone" required autoFocus />
      </Field>
      <Field label="Description (optional)">
        <Textarea name="description" defaultValue={group?.description} />
      </Field>

      <Field label="Who's in it">
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setLive(false)}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left transition-colors",
              !live ? "border-brand-600 bg-brand-50" : "border-line hover:bg-slate-50",
            )}
          >
            <span className="block text-sm font-medium text-slate-800">Pick people</span>
            <span className="block text-xs text-muted">
              A fixed list you tick. It stays as you left it.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setLive(true)}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left transition-colors",
              live ? "border-brand-600 bg-brand-50" : "border-line hover:bg-slate-50",
            )}
          >
            <span className="block text-sm font-medium text-slate-800">
              Live rule <Badge tone="brand">auto</Badge>
            </span>
            <span className="block text-xs text-muted">
              A saved filter. Anyone who starts matching is added automatically.
            </span>
          </button>
        </div>
      </Field>

      {live && (
        <GroupRuleBuilder
          rule={rule}
          onChange={setRule}
          staff={staff}
          tags={tags}
          companies={companies}
          genders={genders}
        />
      )}

      {group && group.rule != null && !live && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Switching to a picked list turns off the rule. Whoever was ticked before the group became
          live comes back — nobody is deleted — but new people will no longer be added for you.
        </p>
      )}

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">{group ? "Save" : "Create group"}</Button>
      </div>
    </form>
  );
}

function MembersForm({
  group,
  allStaff,
  onDone,
}: {
  group: GroupRow;
  allStaff: StaffOpt[];
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveGroupMembers, {});
  const [selected, setSelected] = useState<Set<number>>(new Set(group.memberIds));
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  // Search across name, email and company so "iram" or a surname both work.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allStaff;
    return allStaff.filter((s) =>
      [s.name, s.email, s.companyName].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [allStaff, query]);

  const byCompany = useMemo(() => {
    const map = new Map<string, StaffOpt[]>();
    for (const s of matches) {
      const company = s.companyName ?? "No company";
      if (!map.has(company)) map.set(company, []);
      map.get(company)!.push(s);
    }
    return Array.from(map.entries());
  }, [matches]);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="groupId" value={group.id} />
      {selected.size > 0 &&
        Array.from(selected).map((id) => (
          <input key={id} type="hidden" name="member" value={id} />
        ))}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Search team members by name, email or company…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          autoFocus
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {selected.size} selected
          {query.trim() && ` · ${matches.length} match${matches.length === 1 ? "" : "es"}`}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              // With a search active, only add the people currently listed.
              setSelected((prev) => new Set([...prev, ...matches.map((s) => s.id)]))
            }
          >
            {query.trim() ? "Select matches" : "Select all"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      </div>

      <div className="max-h-80 space-y-4 overflow-y-auto rounded-lg border border-line p-3">
        {byCompany.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">
            {query.trim() ? `No team members match “${query.trim()}”.` : "No active team members to add."}
          </p>
        )}
        {byCompany.map(([company, people]) => (
          <div key={company}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {company}
            </p>
            <div className="space-y-1">
              {people.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-sm text-slate-700">{s.name}</span>
                  {s.email && <span className="text-xs text-muted">{s.email}</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Save members</Button>
      </div>
    </form>
  );
}

/**
 * Who is in this group, read-only.
 *
 * Separate from MembersForm on purpose. That one is the picker — it only
 * exists for hand-picked groups and only for people who can manage groups, so
 * a live-rule group had no way to show its membership at all and a viewer had
 * none for either kind. Seeing who's in a group isn't an admin act.
 */
function MembersView({ group }: { group: GroupRow }) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return group.members;
    return group.members.filter((m) =>
      [m.name, m.email, m.companyName].join(" ").toLowerCase().includes(q),
    );
  }, [group.members, query]);

  // This is an EMAIL group, so somebody in it with no address is a real gap —
  // they're a member who silently receives nothing. Counted, not buried.
  const noEmail = group.members.filter((m) => !m.email.includes("@")).length;

  if (group.members.length === 0) {
    return (
      <EmptyState
        icon={<Users2 className="h-8 w-8" />}
        title="Nobody is in this group"
        description={
          group.rule
            ? "No active team member matches the rule right now."
            : "No active team members have been added to it yet."
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          <strong className="text-slate-700">{group.members.length}</strong>{" "}
          {group.members.length === 1 ? "person" : "people"}
          {noEmail > 0 && (
            <span className="text-amber-700">
              {" "}
              · {noEmail} with no email address
            </span>
          )}
        </p>
        {group.members.length > 8 && (
          <div className="relative w-full max-w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Search this group…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search this group"
            />
          </div>
        )}
      </div>

      {group.rule && (
        <p className="flex items-start gap-1.5 rounded-md bg-brand-50 px-2.5 py-2 text-xs text-brand-800">
          <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Live rule.</strong> This list is worked out every time the group is used, so
            it changes as people are added, tagged or moved.
          </span>
        </p>
      )}

      <div className="max-h-96 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">Nobody here matches that.</p>
        ) : (
          shown.map((m) => (
            <div key={m.staffId} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{m.name}</p>
                <p className="truncate text-xs text-muted">{m.companyName}</p>
              </div>
              {m.email.includes("@") ? (
                <span className="shrink-0 truncate text-xs text-muted">{m.email}</span>
              ) : (
                <span className="shrink-0 text-xs font-medium text-amber-700">No email address</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function GroupsManager({
  groups,
  allStaff,
  allTags,
  companies,
  genders,
  canManage,
}: {
  groups: GroupRow[];
  allStaff: StaffOpt[];
  allTags: RuleTag[];
  companies: RuleCompany[];
  genders: string[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [members, setMembers] = useState<GroupRow | null>(null);
  const [viewing, setViewing] = useState<GroupRow | null>(null);

  const lookup = {
    companyName: (id: number) => companies.find((c) => c.id === id)?.name,
    tagName: (id: number) => allTags.find((t) => t.id === id)?.name,
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New group
          </Button>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={<Mails className="h-8 w-8" />}
          title="No email groups yet"
          description="Create groups like “Everyone” or “Directors” to target announcements."
          action={canManage ? <Button onClick={() => setAdding(true)}>New group</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.id}>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">{g.name}</h3>
                  {/* The count was the one thing telling you a group had 4
                      people in it, and it wasn't clickable. Now it is. */}
                  <button
                    type="button"
                    onClick={() => setViewing(g)}
                    title="See who's in this group"
                    className="shrink-0 rounded-full transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  >
                    <Badge tone="brand">
                      <Users2 className="mr-1 h-3 w-3" /> {g.memberCount}
                    </Badge>
                  </button>
                </div>
                {g.description && <p className="text-sm text-muted">{g.description}</p>}
                {g.rule && (
                  <p className="flex items-start gap-1.5 rounded-md bg-brand-50 px-2 py-1.5 text-xs text-brand-800">
                    <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      <strong>Live rule.</strong> {describeRule(g.rule, lookup)}
                    </span>
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {/* Available to everyone who can see the page, and for both
                      kinds of group — reading a membership isn't an admin act,
                      and a live-rule group had no way to show one at all. */}
                  <Button variant="outline" size="sm" onClick={() => setViewing(g)}>
                    <Users2 className="h-3.5 w-3.5" /> Who&apos;s in it
                  </Button>
                  {canManage && (
                    <>
                      {/* A rule decides the membership, so picking people would
                          be a control that quietly does nothing. */}
                      {!g.rule && (
                        <Button variant="ghost" size="sm" onClick={() => setMembers(g)}>
                          Edit members
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setEditing(g)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Delete group “${g.name}”?`)) deleteGroup(g.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {adding && (
        <Modal title="New email group" open onOpenChange={setAdding} wide>
          <GroupForm
            staff={allStaff}
            tags={allTags}
            companies={companies}
            genders={genders}
            onDone={() => setAdding(false)}
          />
        </Modal>
      )}
      {editing && (
        <Modal
          title={`Edit ${editing.name}`}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          wide
        >
          <GroupForm
            group={editing}
            staff={allStaff}
            tags={allTags}
            companies={companies}
            genders={genders}
            onDone={() => setEditing(null)}
          />
        </Modal>
      )}
      {viewing && (
        <Modal
          title={`Who's in ${viewing.name}`}
          description={
            viewing.rule
              ? "Worked out from the group's rule, as it stands right now."
              : "The team members added to this group."
          }
          open
          onOpenChange={(o) => !o && setViewing(null)}
        >
          <MembersView group={viewing} />
        </Modal>
      )}
      {members && (
        <Modal
          title={`Members — ${members.name}`}
          description="Choose who belongs to this group."
          open
          onOpenChange={(o) => !o && setMembers(null)}
          wide
        >
          <MembersForm group={members} allStaff={allStaff} onDone={() => setMembers(null)} />
        </Modal>
      )}
    </div>
  );
}
