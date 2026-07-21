"use client";

import { Fragment, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { setRolePermission, resetRoleDefaults } from "@/app/actions/roles";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RoleCol = { id: number; name: string; key: string; description: string };
type PermRow = { key: string; label: string; id: number };
type Category = { category: string; perms: PermRow[] };

const LOCKED = "super_admin";

export function RolesGrid({
  roles,
  categories,
  initialGrants,
}: {
  roles: RoleCol[];
  categories: Category[];
  initialGrants: string[];
}) {
  const [grants, setGrants] = useState<Set<string>>(new Set(initialGrants));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isOn = (roleId: number, permId: number, roleKey: string) =>
    roleKey === LOCKED || grants.has(`${roleId}:${permId}`);

  const toggle = (roleId: number, permId: number) => {
    const key = `${roleId}:${permId}`;
    const enabling = !grants.has(key);

    // optimistic
    setGrants((prev) => {
      const next = new Set(prev);
      enabling ? next.add(key) : next.delete(key);
      return next;
    });
    setError(null);

    startTransition(async () => {
      const res = await setRolePermission(roleId, permId, enabling);
      if (res?.error) {
        // revert
        setGrants((prev) => {
          const next = new Set(prev);
          enabling ? next.delete(key) : next.add(key);
          return next;
        });
        setError(res.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <Card className="overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-10 border-b border-line bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  Permission
                </th>
                {roles.map((r) => (
                  <th
                    key={r.id}
                    className="border-b border-l border-line px-4 py-3 text-center align-bottom"
                  >
                    <div className="text-sm font-semibold text-slate-900">{r.name}</div>
                    <div className="mx-auto mt-0.5 max-w-[9rem] text-[11px] font-normal leading-tight text-muted">
                      {r.description}
                    </div>
                    {r.key !== LOCKED && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Reset ${r.name} to default permissions?`))
                            startTransition(async () => {
                              await resetRoleDefaults(r.id);
                              // Refresh via full reload of grants is simplest:
                              location.reload();
                            });
                        }}
                        className="mx-auto mt-1 flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:text-brand-800"
                        title="Reset to defaults"
                      >
                        <RotateCcw className="h-3 w-3" /> defaults
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <Fragment key={cat.category}>
                  <tr>
                    <td
                      colSpan={roles.length + 1}
                      className="border-b border-line bg-slate-100/70 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {cat.category}
                    </td>
                  </tr>
                  {cat.perms.map((p) => (
                    <tr key={p.key} className="hover:bg-slate-50/60">
                      <td className="sticky left-0 z-10 border-b border-line bg-white px-4 py-3 text-slate-700">
                        {p.label}
                        <span className="ml-2 font-mono text-[10px] text-slate-400">{p.key}</span>
                      </td>
                      {roles.map((r) => {
                        const on = isOn(r.id, p.id, r.key);
                        const locked = r.key === LOCKED;
                        return (
                          <td
                            key={r.id}
                            className="border-b border-l border-line px-4 py-2 text-center"
                          >
                            <button
                              type="button"
                              role="switch"
                              aria-checked={on}
                              disabled={locked || pending}
                              onClick={() => toggle(r.id, p.id)}
                              className={cn(
                                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                                on ? "bg-brand-600" : "bg-slate-200",
                                locked ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                              )}
                            >
                              <span
                                className={cn(
                                  "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                                  on ? "translate-x-4" : "translate-x-0.5",
                                )}
                              />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-muted">
        Changes save automatically. The Super Admin role is locked to full access to prevent
        lock-outs.
      </p>
    </div>
  );
}
