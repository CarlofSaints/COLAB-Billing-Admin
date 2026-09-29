"use client";

import { CheckCircle2, FileText, Layers } from "lucide-react";
import type { InvoiceSide } from "@/lib/expense-accounts";
import { cn } from "@/lib/utils";

export type InvoiceSideFilter = InvoiceSide | "all";

export type InvoiceSideSummary = {
  count: number;
  /** Leave out on a page with no amounts (Expense Accounts has no spend). */
  amount?: string;
  /** One line under the figure, e.g. "3 also carry a balance on Variable". */
  hint?: string;
};

const SIDES: {
  key: InvoiceSide;
  title: string;
  blurb: string;
  icon: typeof FileText;
}[] = [
  {
    key: "static",
    title: "On the Static invoice",
    blurb: "Already billed: rent and fixed line items",
    icon: CheckCircle2,
  },
  {
    key: "variable",
    title: "On the Variable invoice",
    blurb: "Split from this month's Xero costs",
    icon: Layers,
  },
];

/**
 * Two cards, Static and Variable, that also filter the grid below. Click one
 * to show only its rows; click it again (or "Show all") to clear.
 */
export function InvoiceSideCards({
  filter,
  onChange,
  summary,
  unit,
}: {
  filter: InvoiceSideFilter;
  onChange: (next: InvoiceSideFilter) => void;
  summary: Record<InvoiceSide, InvoiceSideSummary>;
  /** "supplier line" / "account" — pluralised with an "s". */
  unit: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {SIDES.map(({ key, title, blurb, icon: Icon }) => {
        const active = filter === key;
        const s = summary[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(active ? "all" : key)}
            aria-pressed={active}
            className={cn(
              "rounded-lg border px-4 py-3 text-left transition-colors",
              active
                ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600"
                : "border-line bg-white hover:bg-slate-50",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Icon className={cn("h-4 w-4", key === "static" ? "text-emerald-600" : "text-brand-600")} />
                {title}
              </span>
              <span className="text-xs font-medium text-muted">
                {active ? "Showing only these · click to clear" : "Click to filter"}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
              {s.amount && (
                <span className="text-lg font-semibold tabular-nums text-slate-900">{s.amount}</span>
              )}
              <span className={cn(s.amount ? "text-sm text-muted" : "text-lg font-semibold text-slate-900")}>
                {s.count} {unit}
                {s.count === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted">{s.hint ?? blurb}</p>
          </button>
        );
      })}
    </div>
  );
}

/** Compact All / Static / Variable switch for a grid's toolbar. */
export function InvoiceSideSwitch({
  filter,
  onChange,
  counts,
}: {
  filter: InvoiceSideFilter;
  onChange: (next: InvoiceSideFilter) => void;
  counts: Record<InvoiceSideFilter, number>;
}) {
  const options: { key: InvoiceSideFilter; label: string }[] = [
    { key: "all", label: "Both invoices" },
    { key: "static", label: "Static" },
    { key: "variable", label: "Variable" },
  ];
  return (
    <div
      role="group"
      aria-label="Filter by invoice"
      className="inline-flex overflow-hidden rounded-lg border border-line"
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={filter === o.key}
          className={cn(
            "inline-flex items-center gap-1.5 border-l border-line px-3 py-2 text-sm font-medium first:border-l-0",
            filter === o.key ? "bg-brand-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50",
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          {o.label}
          <span
            className={cn(
              "rounded-full px-1.5 text-xs tabular-nums",
              filter === o.key ? "bg-white/20" : "bg-slate-100 text-slate-600",
            )}
          >
            {counts[o.key]}
          </span>
        </button>
      ))}
    </div>
  );
}
