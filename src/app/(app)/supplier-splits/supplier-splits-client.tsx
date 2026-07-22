"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Plug,
  Wand2,
  Pin,
  CalendarRange,
} from "lucide-react";
import {
  saveSupplierSplits,
  pinInheritedSplits,
  type ActionState,
} from "@/app/actions/supplier-splits";
import {
  METHODS,
  METHOD_BY_KEY,
  UNMAPPED,
  type AccountMethod,
  type MethodChoice,
} from "@/lib/expense-accounts";
import { periodLabel } from "@/lib/periods";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/page";
import { formatCurrency, cn } from "@/lib/utils";

/** Where a row's current split came from, before the user touches it. */
type Source = "explicit" | "inherited" | "account" | "unset";

export type SupplierRow = {
  key: string;
  accountCode: string;
  accountName: string | null;
  contactId: string;
  supplierName: string;
  amount: number;
  documents: number;
  method: AccountMethod | null;
  companyId: number | null;
  fixedLineItemId: number | null;
  source: Source;
  inheritedFrom: string | null;
};

type Draft = { method: MethodChoice; companyId: number | null; fixedLineItemId: number | null };
type Filter = "all" | "unset" | "inherited" | AccountMethod;

const SOURCE_BADGE: Record<Source, { label: string; tone: "green" | "amber" | "neutral" | "brand" }> = {
  explicit: { label: "Set this month", tone: "green" },
  inherited: { label: "Carried forward", tone: "brand" },
  account: { label: "Account default", tone: "neutral" },
  unset: { label: "Not split", tone: "amber" },
};

function toDraft(rows: SupplierRow[]): Record<string, Draft> {
  return Object.fromEntries(
    rows.map((r) => [
      r.key,
      {
        method: (r.method ?? UNMAPPED) as MethodChoice,
        companyId: r.companyId,
        fixedLineItemId: r.fixedLineItemId,
      },
    ]),
  );
}

function same(a: Draft, b: Draft) {
  return (
    a.method === b.method && a.companyId === b.companyId && a.fixedLineItemId === b.fixedLineItemId
  );
}

export function SupplierSplitsClient({
  period,
  periods,
  rows,
  companies,
  fixedItems,
  canManage,
  hiddenNonExpense,
  xero,
}: {
  period: string;
  periods: string[];
  rows: SupplierRow[];
  companies: { id: number; name: string }[];
  fixedItems: { id: number; name: string; unitAmount: number }[];
  canManage: boolean;
  hiddenNonExpense: number;
  xero: { connected: boolean; tenantName: string | null; error: string | null };
}) {
  const router = useRouter();
  const [baseline, setBaseline] = useState(() => toDraft(rows));
  const [draft, setDraft] = useState(() => toDraft(rows));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMethod, setBulkMethod] = useState<MethodChoice>("headcount");
  const [busy, setBusy] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(saveSupplierSplits, {});

  // Re-baseline when the server sends a new month (or a save comes back).
  const [seen, setSeen] = useState(rows);
  if (seen !== rows) {
    const fresh = toDraft(rows);
    setSeen(rows);
    setBaseline(fresh);
    setDraft(fresh);
    setSelected(new Set());
    setBusy(false);
  }

  const dirtyKeys = useMemo(
    () => rows.map((r) => r.key).filter((k) => draft[k] && baseline[k] && !same(draft[k], baseline[k])),
    [rows, draft, baseline],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, unset: 0, inherited: 0 };
    for (const m of METHODS) c[m.key] = 0;
    for (const r of rows) {
      const method = draft[r.key]?.method ?? UNMAPPED;
      if (method === UNMAPPED) c.unset += 1;
      else c[method] += 1;
      if (r.source === "inherited") c.inherited += 1;
    }
    return c;
  }, [rows, draft]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const method = draft[r.key]?.method ?? UNMAPPED;
      if (filter === "unset" && method !== UNMAPPED) return false;
      if (filter === "inherited" && r.source !== "inherited") return false;
      if (filter !== "all" && filter !== "unset" && filter !== "inherited" && method !== filter)
        return false;
      if (!q) return true;
      return (
        r.supplierName.toLowerCase().includes(q) ||
        r.accountCode.toLowerCase().includes(q) ||
        (r.accountName ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, draft, filter, query]);

  const setRow = (key: string, patch: Partial<Draft>) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const changeMethod = (key: string, method: MethodChoice) =>
    setRow(key, {
      method,
      companyId: method === "direct" ? (draft[key]?.companyId ?? null) : null,
      fixedLineItemId: method === "fixed" ? (draft[key]?.fixedLineItemId ?? null) : null,
    });

  const applyBulk = () => {
    setDraft((d) => {
      const next = { ...d };
      for (const key of selected) {
        if (!next[key]) continue;
        next[key] = {
          method: bulkMethod,
          companyId: bulkMethod === "direct" ? next[key].companyId : null,
          fixedLineItemId: bulkMethod === "fixed" ? next[key].fixedLineItemId : null,
        };
      }
      return next;
    });
    setSelected(new Set());
  };

  const pinAll = async () => {
    const carried = rows.filter((r) => r.source !== "explicit" && r.method);
    if (carried.length === 0) return;
    if (
      !confirm(
        `Pin ${carried.length} carried-forward split(s) into ${periodLabel(period)}?\n\nThey'll be stored against this month, so later changes to earlier months won't move them.`,
      )
    )
      return;
    setBusy(true);
    await pinInheritedSplits(
      period,
      carried.map((r) => ({
        accountCode: r.accountCode,
        accountName: r.accountName,
        xeroContactId: r.contactId,
        supplierName: r.supplierName,
        amount: r.amount,
        method: r.method as string,
        companyId: r.companyId,
        fixedLineItemId: r.fixedLineItemId,
      })),
    );
    router.refresh();
  };

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.key));

  const payload = JSON.stringify(
    dirtyKeys.map((key) => {
      const r = rows.find((x) => x.key === key)!;
      const d = draft[key];
      return {
        accountCode: r.accountCode,
        accountName: r.accountName,
        xeroContactId: r.contactId,
        supplierName: r.supplierName,
        amount: r.amount,
        method: d.method === UNMAPPED ? null : d.method,
        companyId: d.companyId,
        fixedLineItemId: d.fixedLineItemId,
      };
    }),
  );

  const monthPicker = (
    <div className="flex items-center gap-2">
      <CalendarRange className="h-4 w-4 text-muted" />
      <Select
        className="w-44"
        value={period}
        onChange={(e) => router.push(`/supplier-splits?period=${e.target.value}`)}
      >
        {periods.map((p) => (
          <option key={p} value={p}>
            {periodLabel(p)}
          </option>
        ))}
      </Select>
    </div>
  );

  if (!xero.connected) {
    return (
      <EmptyState
        icon={<Plug className="h-10 w-10" />}
        title="Xero isn't connected yet"
        description="Connect the COLAB organisation on the Integrations page to pull supplier spend."
        action={<Button onClick={() => router.push("/integrations")}>Go to Integrations</Button>}
      />
    );
  }

  const totalSpend = rows.reduce((s, r) => s + r.amount, 0);
  const unsplitValue = rows
    .filter((r) => (draft[r.key]?.method ?? UNMAPPED) === UNMAPPED)
    .reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4 pb-24">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{periodLabel(period)}</CardTitle>
            <CardDescription>
              Every supplier that hit an expense account this month. Anything you don&apos;t set
              here keeps last month&apos;s split, or falls back to the account&apos;s own method.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {monthPicker}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBusy(true);
                router.refresh();
              }}
              disabled={busy}
            >
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {xero.error && (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Couldn&apos;t read this month from Xero: {xero.error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Stat label="Supplier lines" value={String(rows.length)} />
            <Stat label="Total spend" value={formatCurrency(totalSpend)} tone="brand" />
            <Stat
              label="Not split"
              value={counts.unset > 0 ? `${counts.unset} · ${formatCurrency(unsplitValue)}` : "None"}
              tone={counts.unset > 0 ? "amber" : undefined}
            />
            <Stat label="Carried forward" value={String(counts.inherited)} />
          </div>

          {hiddenNonExpense > 0 && (
            <p className="text-xs text-muted">
              {hiddenNonExpense} supplier line{hiddenNonExpense === 1 ? "" : "s"} hidden — they hit
              balance-sheet accounts (PAYE, salary control, loans), which are never recharged.
            </p>
          )}

          {counts.unset > 0 ? (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {formatCurrency(unsplitValue)} across {counts.unset} supplier line
              {counts.unset === 1 ? "" : "s"} has no split — it won&apos;t be recharged to anyone.
            </p>
          ) : (
            <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              Every supplier line for this month has a split.
            </p>
          )}

          {canManage && counts.inherited > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <Pin className="h-4 w-4 text-muted" />
              <span className="text-slate-600">
                {counts.inherited} split{counts.inherited === 1 ? " is" : "s are"} carried forward
                from an earlier month.
              </span>
              <Button variant="outline" size="sm" onClick={pinAll} disabled={busy}>
                Pin to this month
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-stretch gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search supplier or account…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Pill label="All" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
            <Pill
              label="Not split"
              count={counts.unset}
              tone={counts.unset > 0 ? "amber" : undefined}
              active={filter === "unset"}
              onClick={() => setFilter("unset")}
            />
            <Pill
              label="Carried forward"
              count={counts.inherited}
              active={filter === "inherited"}
              onClick={() => setFilter("inherited")}
            />
            {METHODS.map((m) => (
              <Pill
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
                <option value={UNMAPPED}>Clear this month&apos;s split</option>
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
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (allVisibleSelected) visible.forEach((r) => next.delete(r.key));
                        else visible.forEach((r) => next.add(r.key));
                        return next;
                      })
                    }
                    aria-label="Select all visible rows"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                </TH>
              )}
              <TH>Supplier</TH>
              <TH className="w-52">Account</TH>
              <TH className="w-32 text-right">Amount</TH>
              <TH className="w-52">Split method</TH>
              <TH className="w-56">Applies to</TH>
            </tr>
          </THead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <TD colSpan={canManage ? 6 : 5} className="py-10 text-center text-sm text-muted">
                  {rows.length === 0
                    ? "No supplier spend came back from Xero for this month."
                    : "Nothing matches this search or filter."}
                </TD>
              </tr>
            ) : (
              visible.map((r) => {
                const d = draft[r.key];
                const isDirty = dirtyKeys.includes(r.key);
                const method = d?.method ?? UNMAPPED;
                const def = method === UNMAPPED ? null : METHOD_BY_KEY[method];
                const badge = SOURCE_BADGE[isDirty ? "explicit" : r.source];
                return (
                  <TR key={r.key} className={cn(isDirty && "bg-brand-50/40")}>
                    {canManage && (
                      <TD>
                        <input
                          type="checkbox"
                          checked={selected.has(r.key)}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.key)) next.delete(r.key);
                              else next.add(r.key);
                              return next;
                            })
                          }
                          aria-label={`Select ${r.supplierName}`}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                      </TD>
                    )}
                    <TD>
                      <div className="font-medium text-slate-900">{r.supplierName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                        {r.source === "inherited" && r.inheritedFrom && !isDirty && (
                          <span className="text-[11px] text-muted">
                            from {periodLabel(r.inheritedFrom)}
                          </span>
                        )}
                        <span className="text-[11px] text-muted">
                          {r.documents} doc{r.documents === 1 ? "" : "s"}
                        </span>
                      </div>
                    </TD>
                    <TD>
                      <span className="font-mono text-xs text-muted">{r.accountCode}</span>{" "}
                      <span className="text-sm">{r.accountName ?? "—"}</span>
                    </TD>
                    <TD
                      className={cn(
                        "text-right font-medium tabular-nums",
                        r.amount < 0 ? "text-emerald-700" : "text-slate-900",
                      )}
                    >
                      {formatCurrency(r.amount)}
                    </TD>
                    <TD>
                      <Select
                        value={method}
                        disabled={!canManage}
                        onChange={(e) => changeMethod(r.key, e.target.value as MethodChoice)}
                        className={cn(
                          method === UNMAPPED && "border-amber-300 bg-amber-50 text-amber-800",
                        )}
                      >
                        <option value={UNMAPPED}>— Not split —</option>
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
                            setRow(r.key, {
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
                      ) : def?.needs === "fixedItem" ? (
                        <Select
                          value={d?.fixedLineItemId ?? ""}
                          disabled={!canManage}
                          onChange={(e) =>
                            setRow(r.key, {
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

      {canManage && (
        <form action={action}>
          <input type="hidden" name="period" value={period} />
          <input type="hidden" name="payload" value={payload} />
          <SaveBar
            count={dirtyKeys.length}
            error={state.error}
            savedAt={state.savedAt}
            period={period}
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
  period,
  onDiscard,
}: {
  count: number;
  error?: string;
  savedAt?: number;
  period: string;
  onDiscard: () => void;
}) {
  const { pending } = useFormStatus();
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
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        )}
        {!error && showSaved && count === 0 && (
          <p className="mr-auto flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Splits saved for {periodLabel(period)}.
          </p>
        )}
        {count > 0 && (
          <>
            <span className="mr-auto text-sm text-slate-600">
              {count} unsaved change{count === 1 ? "" : "s"} for {periodLabel(period)}
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "brand" | "amber";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-1.5",
        tone === "brand"
          ? "border-brand-200 bg-brand-50"
          : tone === "amber"
            ? "border-amber-200 bg-amber-50"
            : "border-line bg-slate-50",
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div
        className={cn(
          "text-sm font-semibold",
          tone === "brand" ? "text-brand-800" : tone === "amber" ? "text-amber-800" : "text-slate-900",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Pill({
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
