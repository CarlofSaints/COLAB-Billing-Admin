"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Search,
  RefreshCw,
  AlertTriangle,
  Link2Off,
  Plug,
  CheckCircle2,
  Wand2,
} from "lucide-react";
import { saveAccountMappings, type ActionState } from "@/app/actions/expense-accounts";
import {
  METHODS,
  METHOD_BY_KEY,
  UNMAPPED,
  accountTypeLabel,
  type AccountMethod,
  type MethodChoice,
  type PercentEntry,
} from "@/lib/expense-accounts";
import { PercentCell } from "@/components/percent-split";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/page";
import { formatCurrency, cn } from "@/lib/utils";

type AccountRow = {
  accountId: string;
  code: string | null;
  name: string;
  type: string | null;
  description: string | null;
  missing: boolean; // mapped here, but no longer on the Xero chart of accounts
  method: AccountMethod | null;
  companyId: number | null;
  fixedLineItemId: number | null;
  percentages: PercentEntry[] | null;
};

type CompanyOption = { id: number; name: string };
type FixedItemOption = { id: number; name: string; unitAmount: number };

type Draft = {
  method: MethodChoice;
  companyId: number | null;
  fixedLineItemId: number | null;
  percentages: PercentEntry[] | null;
};

type Filter = "all" | "unmapped" | AccountMethod;

function toDraft(rows: AccountRow[]): Record<string, Draft> {
  return Object.fromEntries(
    rows.map((r) => [
      r.accountId,
      {
        method: (r.method ?? UNMAPPED) as MethodChoice,
        companyId: r.companyId,
        fixedLineItemId: r.fixedLineItemId,
        percentages: r.percentages,
      },
    ]),
  );
}

function sameDraft(a: Draft, b: Draft) {
  return (
    a.method === b.method &&
    a.companyId === b.companyId &&
    a.fixedLineItemId === b.fixedLineItemId &&
    JSON.stringify(a.percentages ?? []) === JSON.stringify(b.percentages ?? [])
  );
}

export function ExpenseAccountsClient({
  rows,
  companies,
  fixedItems,
  canManage,
  xero,
}: {
  rows: AccountRow[];
  companies: CompanyOption[];
  fixedItems: FixedItemOption[];
  canManage: boolean;
  xero: { configured: boolean; connected: boolean; tenantName: string | null; error: string | null };
}) {
  const router = useRouter();
  const [baseline, setBaseline] = useState<Record<string, Draft>>(() => toDraft(rows));
  const [draft, setDraft] = useState<Record<string, Draft>>(() => toDraft(rows));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMethod, setBulkMethod] = useState<MethodChoice>("per_sqm");
  const [refreshing, setRefreshing] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(saveAccountMappings, {});

  // Re-baseline whenever the server sends a fresh account list (after a save
  // or a refresh). Adjusting state during render is the supported way to react
  // to changed props — an effect here would cause a second render pass.
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    const fresh = toDraft(rows);
    setSeenRows(rows);
    setBaseline(fresh);
    setDraft(fresh);
    setSelected(new Set());
    setRefreshing(false);
  }

  const dirtyIds = useMemo(
    () =>
      rows
        .map((r) => r.accountId)
        .filter((id) => draft[id] && baseline[id] && !sameDraft(draft[id], baseline[id])),
    [rows, draft, baseline],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, unmapped: 0 };
    for (const m of METHODS) c[m.key] = 0;
    for (const r of rows) {
      const method = draft[r.accountId]?.method ?? UNMAPPED;
      if (method === UNMAPPED) c.unmapped += 1;
      else c[method] += 1;
    }
    return c;
  }, [rows, draft]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const method = draft[r.accountId]?.method ?? UNMAPPED;
      if (filter === "unmapped" && method !== UNMAPPED) return false;
      if (filter !== "all" && filter !== "unmapped" && method !== filter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.code ?? "").toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, draft, filter, query]);

  const setRow = (id: string, patch: Partial<Draft>) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const changeMethod = (id: string, method: MethodChoice) =>
    setRow(id, {
      method,
      // Drop the extra reference when it no longer applies.
      companyId: method === "direct" ? (draft[id]?.companyId ?? null) : null,
      fixedLineItemId: method === "fixed" ? (draft[id]?.fixedLineItemId ?? null) : null,
      percentages: method === "percent" ? (draft[id]?.percentages ?? null) : null,
    });

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.accountId));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((r) => next.delete(r.accountId));
      else visible.forEach((r) => next.add(r.accountId));
      return next;
    });

  const applyBulk = () => {
    setDraft((d) => {
      const next = { ...d };
      for (const id of selected) {
        if (!next[id]) continue;
        next[id] = {
          method: bulkMethod,
          companyId: bulkMethod === "direct" ? next[id].companyId : null,
          fixedLineItemId: bulkMethod === "fixed" ? next[id].fixedLineItemId : null,
          percentages: bulkMethod === "percent" ? next[id].percentages : null,
        };
      }
      return next;
    });
    setSelected(new Set());
  };

  const payload = JSON.stringify(
    dirtyIds.map((id) => {
      const r = rows.find((x) => x.accountId === id)!;
      const d = draft[id];
      return {
        xeroAccountId: r.accountId,
        accountCode: r.code,
        accountName: r.name,
        accountType: r.type,
        method: d.method === UNMAPPED ? null : d.method,
        companyId: d.companyId,
        fixedLineItemId: d.fixedLineItemId,
        percentages: d.percentages,
      };
    }),
  );

  /* ---------------- not connected / no accounts ---------------- */

  if (!xero.connected) {
    return (
      <EmptyState
        icon={<Plug className="h-10 w-10" />}
        title="Xero isn't connected yet"
        description="Connect the COLAB organisation on the Integrations page and its P&L expense accounts will appear here."
        action={
          <Button onClick={() => router.push("/integrations")}>Go to Integrations</Button>
        }
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-10 w-10" />}
        title="No expense accounts came back from Xero"
        description={
          xero.error ??
          "The chart of accounts has no active expense accounts, or Xero didn't return them."
        }
        action={
          <Button
            onClick={() => {
              setRefreshing(true);
              router.refresh();
            }}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} /> Try again
          </Button>
        }
      />
    );
  }

  const mappedCount = rows.length - counts.unmapped;
  const coverage = rows.length > 0 ? (mappedCount / rows.length) * 100 : 0;

  return (
    <div className="space-y-4 pb-24">
      {xero.error && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Couldn&apos;t refresh the account list from Xero ({xero.error}). Showing the accounts
          already mapped here.
        </p>
      )}

      {/* Coverage + legend */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Split mapping</CardTitle>
            <CardDescription>
              Every account the billing run should recharge needs a split method. Unmapped accounts
              are skipped.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {xero.tenantName && <Badge tone="neutral">{xero.tenantName}</Badge>}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRefreshing(true);
                router.refresh();
              }}
              disabled={refreshing}
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              {refreshing ? "Refreshing…" : "Refresh from Xero"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  counts.unmapped === 0 ? "bg-emerald-500" : "bg-brand-600",
                )}
                style={{ width: `${coverage}%` }}
              />
            </div>
            <span className="text-sm font-medium text-slate-700">
              {mappedCount} of {rows.length} mapped
            </span>
          </div>

          {counts.unmapped > 0 ? (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {counts.unmapped} account{counts.unmapped === 1 ? "" : "s"} still have no split
              method. Their costs won&apos;t appear on any sub-company invoice until they do.
            </p>
          ) : (
            <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              Every expense account has a split method.
            </p>
          )}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {METHODS.map((m) => (
              <div key={m.key} className="rounded-lg border border-line px-3 py-2">
                <Badge tone={m.tone}>{m.short}</Badge>
                <p className="mt-1.5 text-xs text-muted">{m.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Grid */}
      <Card>
        <CardHeader className="flex-col items-stretch gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by account name or code…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <FilterPill label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
            <FilterPill
              label="Unmapped"
              count={counts.unmapped}
              tone={counts.unmapped > 0 ? "amber" : undefined}
              active={filter === "unmapped"}
              onClick={() => setFilter("unmapped")}
            />
            {METHODS.map((m) => (
              <FilterPill
                key={m.key}
                label={m.short}
                count={counts[m.key]}
                active={filter === m.key}
                onClick={() => setFilter(m.key)}
              />
            ))}
          </div>

          {canManage && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
              <Wand2 className="h-4 w-4 text-brand-700" />
              <span className="text-sm font-medium text-brand-800">
                {selected.size} selected — set to
              </span>
              <Select
                value={bulkMethod}
                onChange={(e) => setBulkMethod(e.target.value as MethodChoice)}
                className="w-56"
              >
                {METHODS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
                <option value={UNMAPPED}>Clear mapping</option>
              </Select>
              <Button size="sm" onClick={applyBulk}>
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Cancel
              </Button>
            </div>
          )}
        </CardHeader>

        <Table sticky>
          <THead sticky>
            <tr>
              {canManage && (
                <TH className="w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="Select all visible accounts"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                </TH>
              )}
              <TH className="w-24">Code</TH>
              <TH>Account</TH>
              <TH className="w-56">Split method</TH>
              <TH className="w-64">Applies to</TH>
            </tr>
          </THead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <TD colSpan={canManage ? 5 : 4} className="py-10 text-center text-sm text-muted">
                  No accounts match this search or filter.
                </TD>
              </tr>
            ) : (
              visible.map((r) => {
                const d = draft[r.accountId];
                const isDirty = dirtyIds.includes(r.accountId);
                const method = d?.method ?? UNMAPPED;
                const def = method === UNMAPPED ? null : METHOD_BY_KEY[method];
                return (
                  <TR key={r.accountId} className={cn(isDirty && "bg-brand-50/40")}>
                    {canManage && (
                      <TD>
                        <input
                          type="checkbox"
                          checked={selected.has(r.accountId)}
                          onChange={() => toggleRow(r.accountId)}
                          aria-label={`Select ${r.name}`}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                      </TD>
                    )}
                    <TD className="font-mono text-xs text-muted">{r.code ?? "—"}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{r.name}</span>
                        {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />}
                        {r.missing && (
                          <Badge tone="red" className="gap-1">
                            <Link2Off className="h-3 w-3" /> Not in Xero
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted">
                        {accountTypeLabel(r.type)}
                        {r.description ? ` · ${r.description}` : ""}
                      </div>
                    </TD>
                    <TD>
                      <Select
                        value={method}
                        disabled={!canManage}
                        onChange={(e) => changeMethod(r.accountId, e.target.value as MethodChoice)}
                        className={cn(
                          method === UNMAPPED && "border-amber-300 bg-amber-50 text-amber-800",
                        )}
                      >
                        <option value={UNMAPPED}>— Not set —</option>
                        {METHODS.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </Select>
                    </TD>
                    <TD>
                      {def?.needs === "company" ? (
                        <Select
                          value={d?.companyId ?? ""}
                          disabled={!canManage}
                          onChange={(e) =>
                            setRow(r.accountId, {
                              companyId: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          className={cn(!d?.companyId && "border-amber-300 bg-amber-50")}
                        >
                          <option value="">Choose a sub-company…</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                      ) : def?.needs === "percentages" ? (
                        <PercentCell
                          value={d?.percentages ?? null}
                          companies={companies}
                          disabled={!canManage}
                          onChange={(entries) => setRow(r.accountId, { percentages: entries })}
                        />
                      ) : def?.needs === "fixedItem" ? (
                        <Select
                          value={d?.fixedLineItemId ?? ""}
                          disabled={!canManage}
                          onChange={(e) =>
                            setRow(r.accountId, {
                              fixedLineItemId: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                        >
                          <option value="">Not linked to an item</option>
                          {fixedItems.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name} · {formatCurrency(f.unitAmount)} each
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-sm text-muted">{def?.applies ?? "—"}</span>
                      )}
                    </TD>
                  </TR>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      {/* Sticky save bar */}
      {canManage && (
        <form action={action}>
          <input type="hidden" name="payload" value={payload} />
          <SaveBar
            count={dirtyIds.length}
            error={state.error}
            savedAt={state.savedAt}
            onDiscard={() => setDraft(baseline)}
          />
        </form>
      )}
    </div>
  );
}

function SaveBar({
  count,
  error,
  savedAt,
  onDiscard,
}: {
  count: number;
  error?: string;
  savedAt?: number;
  onDiscard: () => void;
}) {
  const { pending } = useFormStatus();
  // The "saved" note fades itself out a few seconds after each save.
  const [dismissed, setDismissed] = useState<number | undefined>(undefined);
  const showSaved = Boolean(savedAt) && dismissed !== savedAt;

  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setDismissed(savedAt), 4000);
    return () => clearTimeout(t);
  }, [savedAt]);

  if (count === 0 && !error && !showSaved) return null;

  return (
    <div className="fixed bottom-0 left-64 right-0 z-20 border-t border-line bg-white/95 px-6 py-3 shadow-[0_-2px_10px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && (
          <p className="mr-auto flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        )}
        {!error && showSaved && count === 0 && (
          <p className="mr-auto flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Mappings saved.
          </p>
        )}
        {count > 0 && (
          <>
            <span className="mr-auto text-sm text-slate-600">
              {count} unsaved change{count === 1 ? "" : "s"}
            </span>
            <Button type="button" variant="ghost" onClick={onDiscard} disabled={pending}>
              Discard
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : `Save ${count} change${count === 1 ? "" : "s"}`}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function FilterPill({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: "amber";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-brand-600 bg-brand-700 text-white"
          : tone === "amber"
            ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
            : "border-line bg-white text-slate-600 hover:bg-slate-50",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-xs tabular-nums",
          active ? "bg-white/20" : "bg-slate-100 text-slate-600",
        )}
      >
        {count}
      </span>
    </button>
  );
}
