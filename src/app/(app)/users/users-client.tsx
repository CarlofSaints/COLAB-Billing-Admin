"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import {
  UserCog,
  Plus,
  KeyRound,
  Copy,
  Mail,
  MailCheck,
  AlertTriangle,
  Trash2,
  Search,
  Pencil,
  UserPlus,
} from "lucide-react";
import {
  createUser,
  updateUser,
  addUserToTeamList,
  updateUserRole,
  setUserActive,
  resetUserPassword,
  resendCredentials,
  deleteUser,
  type UserActionState,
} from "@/app/actions/users";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TH, SortableTH, TR, TD } from "@/components/ui/table";
import { useTableSort } from "@/lib/use-table-sort";
import { formatDateTime } from "@/lib/utils";

type RoleOpt = { id: number; name: string; key: string };
type UserRow = {
  id: number;
  name: string;
  email: string;
  active: boolean;
  lastLogin: string | null;
  mustChangePassword: boolean;
  roleId: number;
  roleName: string;
  roleKey: string;
  /** Sub-company they're on the team list under, or null if they aren't. */
  teamCompany: string | null;
  teamActive: boolean;
};

function TempPasswordNote({ pw, mustReset = true }: { pw: string; mustReset?: boolean }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      <p className="font-medium">Temporary password — share it securely:</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="rounded bg-white px-2 py-1 font-mono text-sm">{pw}</code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigator.clipboard?.writeText(pw)}
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
      </div>
      {mustReset && (
        <p className="mt-1 text-xs">They&apos;ll be asked to change it on first sign-in.</p>
      )}
    </div>
  );
}

/** A labelled checkbox row, styled like the other option lists in the app. */
function CheckOption({
  name,
  label,
  hint,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-slate-50">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

function AddUserForm({
  roles,
  companies,
  onDone,
}: {
  roles: RoleOpt[];
  companies: { id: number; name: string }[];
  onDone: () => void;
}) {
  const [state, action] = useActionState<UserActionState, FormData>(createUser, {});
  const [sendCredentials, setSendCredentials] = useState(true);
  const [mustChange, setMustChange] = useState(true);
  // Off by default — creating a login for an outside accountant or auditor
  // shouldn't quietly put them on the staff list.
  const [addToTeam, setAddToTeam] = useState(false);
  const [teamCompanyId, setTeamCompanyId] = useState(companies[0]?.id ?? 0);

  if (state.ok && state.tempPassword) {
    return (
      <div className="space-y-4">
        {state.emailed && (
          <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Sign-in details emailed to {state.emailTo}.
          </p>
        )}
        {state.emailError && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            The user was created, but the email didn&apos;t send: {state.emailError} Share the
            password below instead.
          </p>
        )}
        {state.teamNote && (
          <p className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {state.teamNote}
          </p>
        )}
        <TempPasswordNote pw={state.tempPassword} mustReset={mustChange} />
        <div className="flex justify-end">
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <Field label="Full name">
        <Input name="name" required autoFocus />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" required />
      </Field>
      <Field label="Role">
        <Select name="roleId" required defaultValue="">
          <option value="" disabled>
            Select a role…
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="space-y-2">
        <CheckOption
          name="addToTeamList"
          label="Also add them to the team list"
          hint="A role says what someone may do; the team list is who works here. Without this they can sign in but have no profile, never show in birthdays, and can't be tagged — so no reception rota and no tagged costs."
          checked={addToTeam}
          onChange={setAddToTeam}
        />
        {addToTeam && (
          <div className="ml-7">
            <Field label="Which company?">
              <Select
                name="teamCompanyId"
                value={teamCompanyId}
                onChange={(e) => setTeamCompanyId(Number(e.target.value))}
                className="max-w-64"
              >
                <option value={0} disabled>
                  Select a company…
                </option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="mt-1 text-xs text-muted">
              If they&apos;re already on the team list under this email, they&apos;ll simply be
              linked to it. New entries start excluded from the billing headcount — billing for
              someone is a separate decision.
            </p>
          </div>
        )}
        <CheckOption
          name="sendCredentials"
          label="Send user credentials"
          hint="Emails them the sign-in link, their email address and the temporary password."
          checked={sendCredentials}
          onChange={setSendCredentials}
        />
        <CheckOption
          name="mustChangePassword"
          label="Force user to reset password on first sign-in"
          hint="They must choose their own password before they can use the portal."
          checked={mustChange}
          onChange={setMustChange}
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Create user</Button>
      </div>
    </form>
  );
}

/** Edit a user's name and sign-in email. */
function EditUserForm({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const [state, action] = useActionState<UserActionState, FormData>(updateUser, {});
  const [email, setEmail] = useState(user.email);

  useEffect(() => {
    if (state.ok && !state.teamNote) onDone();
  }, [state.ok, state.teamNote, onDone]);

  if (state.ok && state.teamNote) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.teamNote}
        </p>
        <div className="flex justify-end">
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={user.id} />
      <Field label="Full name">
        <Input name="name" defaultValue={user.name} required autoFocus />
      </Field>
      <Field label="Email" hint="This is what they sign in with.">
        <Input
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </Field>

      {emailChanged && user.teamCompany && (
        <p className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Their team-member record moves to the new address at the same time, so their profile,
          photo and birthday stay attached to them.
        </p>
      )}

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Save changes</Button>
      </div>
    </form>
  );
}

/** Put an existing user on the team list. */
function AddToTeamForm({
  user,
  companies,
  onDone,
}: {
  user: UserRow;
  companies: { id: number; name: string }[];
  onDone: () => void;
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? 0);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<UserActionState | null>(null);

  if (result?.ok) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {result.teamNote}
        </p>
        <div className="flex justify-end">
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        A role says what someone may do; the team list is who works here.{" "}
        <strong className="text-slate-700">{user.name}</strong> can sign in but isn&apos;t on the
        team list, so they can&apos;t be added to an email group, tagged, put on the reception
        rota, or appear in birthdays or Meet Your Team.
      </p>
      <Field label="Which company?">
        <Select value={companyId} onChange={(e) => setCompanyId(Number(e.target.value))}>
          <option value={0} disabled>
            Select a company…
          </option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-xs text-muted">
        If they&apos;re already on the team list under this email address, they&apos;ll simply be
        linked to it. New entries start excluded from the billing headcount — billing for someone
        is a separate decision.
      </p>
      {result?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={pending || companyId <= 0}
          onClick={() =>
            start(async () => setResult(await addUserToTeamList(user.id, companyId)))
          }
        >
          {pending ? "Adding…" : "Add to team list"}
        </Button>
      </div>
    </div>
  );
}

export function UsersManager({
  users,
  roles,
  companies,
  canManage,
  currentUserId,
}: {
  users: UserRow[];
  roles: RoleOpt[];
  companies: { id: number; name: string }[];
  canManage: boolean;
  currentUserId: number;
}) {
  const [adding, setAdding] = useState(false);
  const [resetPw, setResetPw] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [addingToTeam, setAddingToTeam] = useState<UserRow | null>(null);
  const [resent, setResent] = useState<(UserActionState & { name: string }) | null>(null);
  const [resending, setResending] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  // Same behaviour as the search on Team Members: plain substring match over
  // the fields actually shown in the row, so what you type is what you see.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.name, u.email, u.roleName].join(" ").toLowerCase().includes(q),
    );
  }, [users, query]);

  const { sorted, sort, toggle } = useTableSort(
    filtered,
    {
      user: (u) => u.name,
      role: (u) => u.roleName,
      team: (u) => u.teamCompany,
      // Never signed in reads as blank and sorts last either way, which is
      // what you want when you're hunting for dormant accounts.
      lastLogin: (u) => u.lastLogin,
      status: (u) => (u.active ? "Active" : "Disabled"),
    },
    { key: "user", dir: "asc" },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Search users…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search users"
            />
          </div>
          {query.trim() !== "" && (
            <span className="text-sm text-muted">
              {filtered.length} of {users.length}
            </span>
          )}
        </div>
        {canManage && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        )}
      </div>

      {users.length === 0 ? (
        <EmptyState icon={<UserCog className="h-8 w-8" />} title="No users yet" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<UserCog className="h-8 w-8" />}
          title="No users match that"
          description="Try a different name, email address or role."
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <SortableTH sortKey="user" sort={sort} onSort={toggle}>
                  User
                </SortableTH>
                <SortableTH sortKey="role" sort={sort} onSort={toggle}>
                  Role
                </SortableTH>
                <SortableTH sortKey="team" sort={sort} onSort={toggle}>
                  Team member
                </SortableTH>
                <SortableTH sortKey="lastLogin" sort={sort} onSort={toggle}>
                  Last sign-in
                </SortableTH>
                <SortableTH sortKey="status" sort={sort} onSort={toggle}>
                  Status
                </SortableTH>
                {canManage && <TH className="text-right">Actions</TH>}
              </tr>
            </THead>
            <tbody>
              {sorted.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <TR key={u.id}>
                    <TD>
                      <div className="font-medium text-slate-900">
                        {u.name}
                        {isSelf && <span className="ml-2 text-xs text-muted">(you)</span>}
                      </div>
                      <div className="text-xs text-muted">{u.email}</div>
                    </TD>
                    <TD>
                      {canManage && u.roleKey !== "super_admin" ? (
                        <Select
                          className="h-8 py-1 text-xs"
                          defaultValue={u.roleId}
                          onChange={(e) => updateUserRole(u.id, Number(e.target.value))}
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge tone={u.roleKey === "super_admin" ? "slate" : "brand"}>
                          {u.roleName}
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      {/* The gap this column exists to make visible: a login and
                          a place on the team list are separate things, and
                          nothing used to say which someone had. */}
                      {u.teamCompany ? (
                        <span className="text-sm text-slate-700">
                          {u.teamCompany}
                          {!u.teamActive && (
                            <Badge tone="neutral" className="ml-1">
                              Inactive
                            </Badge>
                          )}
                        </span>
                      ) : canManage ? (
                        <Button variant="outline" size="sm" onClick={() => setAddingToTeam(u)}>
                          <UserPlus className="h-3.5 w-3.5" /> Add to team
                        </Button>
                      ) : (
                        <span className="text-sm text-muted">Not on the team list</span>
                      )}
                    </TD>
                    <TD className="text-sm text-muted">
                      {u.lastLogin ? formatDateTime(u.lastLogin) : "Never"}
                    </TD>
                    <TD>
                      {u.active ? (
                        <Badge tone="green">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Disabled</Badge>
                      )}
                      {u.mustChangePassword && (
                        <Badge tone="amber" className="ml-1">
                          Must reset
                        </Badge>
                      )}
                    </TD>
                    {canManage && (
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit name & email"
                            onClick={() => setEditing(u)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={resending === u.id}
                            title="Resend welcome email & sign-in details"
                            onClick={async () => {
                              if (
                                !confirm(
                                  `Resend the welcome email to ${u.name} (${u.email})?\n\nThey'll be sent a NEW temporary password and asked to change it when they sign in. Any password they have now — including one they chose themselves — stops working.`,
                                )
                              )
                                return;
                              setResending(u.id);
                              const res = await resendCredentials(u.id);
                              setResending(null);
                              setResent({ ...res, name: u.name });
                            }}
                          >
                            <Mail className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Reset password"
                            onClick={async () => {
                              if (confirm(`Reset password for ${u.name}?`)) {
                                const res = await resetUserPassword(u.id);
                                if (res.tempPassword) setResetPw(res.tempPassword);
                              }
                            }}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          {!isSelf && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setUserActive(u.id, !u.active)}
                              >
                                {u.active ? "Disable" : "Enable"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Delete user"
                                onClick={async () => {
                                  if (
                                    !confirm(
                                      `Permanently delete ${u.name} (${u.email})?\n\nThey lose access immediately and this can't be undone. To keep the account but block sign-in, use Disable instead.`,
                                    )
                                  )
                                    return;
                                  const res = await deleteUser(u.id);
                                  if (res?.error) alert(res.error);
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
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {adding && (
        <Modal title="Add user" open onOpenChange={setAdding}>
          <AddUserForm
            roles={roles}
            companies={companies}
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
          <EditUserForm user={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {addingToTeam && (
        <Modal
          title={`Add ${addingToTeam.name} to the team list`}
          open
          onOpenChange={(o) => !o && setAddingToTeam(null)}
        >
          <AddToTeamForm
            user={addingToTeam}
            companies={companies}
            onDone={() => setAddingToTeam(null)}
          />
        </Modal>
      )}
      {resent && (
        <Modal
          title={resent.error ? "Nothing was sent" : `Welcome email — ${resent.name}`}
          open
          onOpenChange={(o) => !o && setResent(null)}
        >
          <div className="space-y-4">
            {resent.error ? (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {resent.error}
              </p>
            ) : (
              <>
                {resent.emailed ? (
                  <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    Welcome email and sign-in details sent to {resent.emailTo}.
                  </p>
                ) : (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    The password was reset, but the email didn&apos;t send: {resent.emailError} Share
                    the password below instead — the old one no longer works.
                  </p>
                )}
                {/* Shown on success too: the send can report OK and still land in
                    a junk folder, and this is the one moment the password is
                    readable. */}
                {resent.tempPassword && <TempPasswordNote pw={resent.tempPassword} />}
              </>
            )}
            <div className="flex justify-end">
              <Button onClick={() => setResent(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}
      {resetPw && (
        <Modal title="Password reset" open onOpenChange={(o) => !o && setResetPw(null)}>
          <div className="space-y-4">
            <TempPasswordNote pw={resetPw} />
            <div className="flex justify-end">
              <Button onClick={() => setResetPw(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
