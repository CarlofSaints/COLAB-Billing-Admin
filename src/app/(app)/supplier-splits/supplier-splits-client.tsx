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
  TriangleAlert,
} from "lucide-react";
import {
  saveSupplierSplits,
  pinInheritedSplits,
  type ActionState,
} from "@/app/actions/supplier-splits";
import {
  METHODS,
  METHOD_BY_KEY,
  BALANCE_METHODS,
  UNMAPPED,
  type AccountMethod,
  type MethodChoice,
  type PercentEntry,
} from "@/lib/expense-accounts";
import { PercentCell } from "@/components/percent-split";
import { periodLabel } from "@/lib/periods";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/page";
import { formatCurrency, cn } from "@/lib/utils";
import { SensitiveAmount } from "@/components/sensitive-amount";

/** Where a row's current split came from, before the user touches it. */
type Source = "explicit" | "inherited" | "account" | "unset";

export type SupplierRow = {
  key: string;
  accountCode: string;
  accountName: string | null;
  contactId: string;
  supplierName: string;
  /** null when the account is restricted and the viewer hasn't unlocked it. */
  amount: number | null;
  documents: number;
  method: AccountMethod | null;
  companyId: number | null;
  fixedLineItemId: number | null;
  percentages: PercentEntry[] | null;
  balanceMethod: AccountMethod | null;
  balanceCompanyId: number | null;
  balancePercentages: PercentEntry[] | null;
  source: Source;
  inheritedFrom: string | null;
};

type Draft = {
  method: MethodChoice;
  companyId: number | null;
  fixedLineItemId: number | null;
  percentages: PercentEntry[] | null;
  balanceMethod: MethodChoice;
  balanceCompanyId: number | null;
  balancePercentages: PercentEntry[] | null;
};

type FixedItemOption = {
  id: number;
  name: string;
  unitAmount: number;
  /** What the item's per-company quantities actually recover each month. */
  allocatedTotal: number;
};
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
        percentages: r.percentages,
        balanceMethod: (r.balanceMethod ?? UNMAPPED) as MethodChoice,
        balanceCompanyId: r.balanceCompanyId,
        balancePercentages: r.balancePercentages,
      },
    ]),
  );
}

function same(a: Draft, b: Draft) {
  return (
    a.method === b.method &&
    a.companyId === b.companyId &&
    a.fixedLineItemId === b.fixedLineItemId &&
    JSON.stringify(a.percentages ?? []) === JSON.stringify(b.percentages ?? []) &&
    a.balanceMethod === b.balanceMethod &&
    a.balanceCompanyId === b.balanceCompanyId &&
    JSON.stringify(a.balancePercentages ?? []) === JSON.stringify(b.balancePercentages ?? [])
  );
}

export function SupplierSplitsClient({
  period,
  periods,
  rows,
  companies,
  fixedItems,
  canManage,
  canUnlock,
  hiddenNonExpense,
  xero,
}: {
  period: string;
  periods: string[];
  rows: SupplierRow[];
  companies: { id: number; name: string }[];
  fixedItems: FixedItemOption[];
  canManage: boolean;
  canUnlock: boolean;
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
      percentages: method === "percent" ? (draft[key]?.percentages ?? null) : null,
      // The balance decision only exists alongside a fixed line item.
      balanceMethod: method === "fixed" ? (draft[key]?.balanceMethod ?? UNMAPPED) : UNMAPPED,
      balanceCompanyId: method === "fixed" ? (draft[key]?.balanceCompanyId ?? null) : null,
      balancePercentages: method === "fixed" ? (draft[key]?.balancePercentages ?? null) : null,
    });

  const changeBalanceMethod = (key: string, method: MethodChoice) =>
    setRow(key, {
      balanceMethod: method,
      balanceCompanyId: method === "direct" ? (draft[key]?.balanceCompanyId ?? null) : null,
      balancePercentages: method === "percent" ? (draft[key]?.balancePercentages ?? null) : null,
    });

  const applyBulk = () => {
    setDraft((d) => {
      const next = { ...d };
      for (const key of selected) {
        if (!next[key]) continue;
        next[key] = {
          ...next[key],
          method: bulkMethod,
          companyId: bulkMethod === "direct" ? next[key].companyId : null,
          fixedLineItemId: bulkMethod === "fixed" ? next[key].fixedLineItemId : null,
          percentages: bulkMethod === "percent" ? next[key].percentages : null,
          balanceMethod: bulkMethod === "fixed" ? next[key].balanceMethod : UNMAPPED,
          balanceCompanyId: bulkMethod === "fixed" ? next[key].balanceCompanyId : null,
          balancePercentages: bulkMethod === "fixed" ? next[key].balancePercentages : null,
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
        percentages: r.percentages,
        balanceMethod: r.balanceMethod,
        balanceCompanyId: r.balanceCompanyId,
        balancePercentages: r.balancePercentages,
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
        percentages: d.percentages,
        balanceMethod: d.balanceMethod === UNMAPPED ? null : d.balanceMethod,
        balanceCompanyId: d.balanceCompanyId,
        balancePercentages: d.balancePercentages,
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

  // Restricted rows are left out of the totals rather than folded in, so the
  // total can't be used to work out the hidden figure.
  const totalSpend = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const restrictedRows = rows.filter((r) => r.amount === null).length;
  const unsplitValue = rows
    .filter((r) => (draft[r.key]?.method ?? UNMAPPED) === UNMAPPED)
    .reduce((s, r) => s + (r.amount ?? 0), 0);

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
            <Stat
              label="Total spend"
              value={
                restrictedRows > 0
                  ? `${formatCurrency(totalSpend)} + ${restrictedRows} restricted`
                  : formatCurrency(totalSpend)
              }
              tone="brand"
            />
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
                        (r.amount ?? 0) < 0 ? "text-emerald-700" : "text-slate-900",
                      )}
                    >
                      <SensitiveAmount amount={r.amount} canUnlock={canUnlock} />
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
                      ) : def?.needs === "percentages" ? (
                        <PercentCell
                          value={d?.percentages ?? null}
                          companies={companies}
                          disabled={!canManage}
                          onChange={(entries) => setRow(r.key, { percentages: entries })}
                        />
                      ) : def?.needs === "fixedItem" ? (
                        <FixedWithBalance
                          row={r}
                          draft={d}
                          fixedItems={fixedItems}
                          companies={companies}
                          canManage={canManage}
                          canUnlock={canUnlock}
                          onItemChange={(id) => setRow(r.key, { fixedLineItemId: id })}
                          onBalanceMethod={(m) => changeBalanceMethod(r.key, m)}
                          onBalanceCompany={(id) => setRow(r.key, { balanceCompanyId: id })}
                          onBalancePercentages={(p) => setRow(r.key, { balancePercentages: p })}
                        />
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

/**
 * The fixed-line-item control plus the balance it leaves behind. A fixed item
 * recovers a set amount (e.g. 16 parking bays), which may be less than the
 * supplier actually charged (20 bays) — the shortfall has to be split too,
 * or it silently never reaches an invoice.
 */
function FixedWithBalance({
  row,
  draft,
  fixedItems,
  companies,
  canManage,
  canUnlock,
  onItemChange,
  onBalanceMethod,
  onBalanceCompany,
  onBalancePercentages,
}: {
  row: SupplierRow;
  draft: Draft | undefined;
  fixedItems: FixedItemOption[];
  companies: { id: number; name: string }[];
  canManage: boolean;
  canUnlock: boolean;
  onItemChange: (id: number | null) => void;
  onBalanceMethod: (m: MethodChoice) => void;
  onBalanceCompany: (id: number | null) => void;
  onBalancePercentages: (p: PercentEntry[]) => void;
}) {
  const item = fixedItems.find((f) => f.id === draft?.fixedLineItemId) ?? null;
  const recovered = item?.allocatedTotal ?? 0;
  // With the amount restricted we can't show the balance without disclosing
  // the figure — the balance method is still editable.
  const restricted = row.amount === null;
  const balance = item && !restricted ? Math.round((row.amount! - recovered) * 100) / 100 : 0;
  const matched = item != null && !restricted && Math.abs(balance) < 0.005;
  const balanceMethod = draft?.balanceMethod ?? UNMAPPED;
  const balanceDef = balanceMethod === UNMAPPED ? null : METHOD_BY_KEY[balanceMethod];

  return (
    <div className="space-y-1.5">
      <Select
        value={draft?.fixedLineItemId ?? ""}
        disabled={!canManage}
        onChange={(e) => onItemChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Not linked to an item</option>
        {fixedItems.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} · {formatCurrency(f.allocatedTotal)} allocated
          </option>
        ))}
      </Select>

      {item && restricted ? (
        <div className="space-y-1.5 rounded-md border border-line bg-slate-50 px-2 py-1.5">
          <p className="text-xs text-muted">
            Amount restricted — unlock to see whether a balance is left over. Set how any balance
            splits:
          </p>
          <Select
            value={balanceMethod}
            disabled={!canManage}
            onChange={(e) => onBalanceMethod(e.target.value as MethodChoice)}
            className="text-xs"
          >
            <option value={UNMAPPED}>— Split the balance… —</option>
            {BALANCE_METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      ) : item ? (
        <>
          {matched ? (
            <p className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Matches split total
            </p>
          ) : (
            <div className="space-y-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5">
              <p className="flex items-start gap-1.5 text-xs font-medium text-red-800">
                <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  {balance > 0
                    ? `Split produces balance of ${formatCurrency(balance)}. How do you want to split the balance?`
                    : `Split exceeds the invoice by ${formatCurrency(Math.abs(balance))} — the item recovers more than was charged.`}
                </span>
              </p>
              {balance > 0 && (
                <>
                  <Select
                    value={balanceMethod}
                    disabled={!canManage}
                    onChange={(e) => onBalanceMethod(e.target.value as MethodChoice)}
                    className={cn(
                      "text-xs",
                      balanceMethod === UNMAPPED && "border-red-300 bg-white text-red-800",
                    )}
                  >
                    <option value={UNMAPPED}>— Split the balance… —</option>
                    {BALANCE_METHODS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </Select>

                  {balanceDef?.needs === "company" && (
                    <Select
                      value={draft?.balanceCompanyId ?? ""}
                      disabled={!canManage}
                      onChange={(e) =>
                        onBalanceCompany(e.target.value ? Number(e.target.value) : null)
                      }
                      className={cn("text-xs", !draft?.balanceCompanyId && "border-red-300")}
                    >
                      <option value="">Choose a sub-company…</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}

                  {balanceDef?.needs === "percentages" && (
                    <PercentCell
                      value={draft?.balancePercentages ?? null}
                      companies={companies}
                      disabled={!canManage}
                      onChange={onBalancePercentages}
                    />
                  )}
                </>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted">
            {formatCurrency(row.amount ?? 0)} charged · {formatCurrency(recovered)} recovered by{" "}
            {item.name}
          </p>
        </>
      ) : null}
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
