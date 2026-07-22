"use client";

import { useActionState, useState } from "react";
import { UserCog, Plus, KeyRound, Copy, MailCheck, AlertTriangle } from "lucide-react";
import {
  createUser,
  updateUserRole,
  setUserActive,
  resetUserPassword,
  type UserActionState,
} from "@/app/actions/users";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
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

function AddUserForm({ roles, onDone }: { roles: RoleOpt[]; onDone: () => void }) {
  const [state, action] = useActionState<UserActionState, FormData>(createUser, {});
  const [sendCredentials, setSendCredentials] = useState(true);
  const [mustChange, setMustChange] = useState(true);

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

export function UsersManager({
  users,
  roles,
  canManage,
  currentUserId,
}: {
  users: UserRow[];
  roles: RoleOpt[];
  canManage: boolean;
  currentUserId: number;
}) {
  const [adding, setAdding] = useState(false);
  const [resetPw, setResetPw] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        </div>
      )}

      {users.length === 0 ? (
        <EmptyState icon={<UserCog className="h-8 w-8" />} title="No users yet" />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>User</TH>
                <TH>Role</TH>
                <TH>Last sign-in</TH>
                <TH>Status</TH>
                {canManage && <TH className="text-right">Actions</TH>}
              </tr>
            </THead>
            <tbody>
              {users.map((u) => {
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
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setUserActive(u.id, !u.active)}
                            >
                              {u.active ? "Disable" : "Enable"}
                            </Button>
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
          <AddUserForm roles={roles} onDone={() => setAdding(false)} />
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
