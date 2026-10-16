"use client";

import { useState } from "react";
import { Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/field";
import {
  percentagesValid,
  percentSummary,
  usagePercentages,
  type PercentEntry,
} from "@/lib/expense-accounts";
import { cn } from "@/lib/utils";

/**
 * The "Applies to" cell for the custom-percentage method. Shows the current
 * split and opens an editor — shared by the expense-account and supplier
 * grids so both behave identically.
 */
export function PercentCell({
  value,
  companies,
  disabled,
  onChange,
}: {
  value: PercentEntry[] | null;
  companies: { id: number; name: string }[];
  disabled?: boolean;
  onChange: (entries: PercentEntry[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const valid = percentagesValid(value);
  const nameOf = (id: number) => companies.find((c) => c.id === id)?.name ?? "?";

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default",
          valid
            ? "border-line bg-white text-slate-700 hover:bg-slate-50"
            : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100",
        )}
      >
        <span className="flex items-center gap-1.5">
          <Percent className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {valid ? percentSummary(value, nameOf) : "Set percentages…"}
          </span>
        </span>
      </button>

      {open && (
        <Modal title="Split by percentage" open onOpenChange={(o) => !o && setOpen(false)}>
          <PercentForm
            value={value}
            companies={companies}
            onCancel={() => setOpen(false)}
            onSave={(entries) => {
              onChange(entries);
              setOpen(false);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function PercentForm({
  value,
  companies,
  onSave,
  onCancel,
}: {
  value: PercentEntry[] | null;
  companies: { id: number; name: string }[];
  onSave: (entries: PercentEntry[]) => void;
  onCancel: () => void;
}) {
  const [pcts, setPcts] = useState<Record<number, string>>(
    Object.fromEntries(
      companies.map((c) => [c.id, (value?.find((v) => v.companyId === c.id)?.percent ?? "").toString()]),
    ),
  );

  const [usage, setUsage] = useState<Record<number, string>>(
    Object.fromEntries(
      companies.map((c) => [c.id, (value?.find((v) => v.companyId === c.id)?.usage ?? "").toString()]),
    ),
  );

  // Typing usage (e.g. pages printed) fills the percentages in.
  const setUsageFor = (id: number, raw: string) => {
    const next = { ...usage, [id]: raw };
    setUsage(next);
    const shares = usagePercentages(companies.map((c) => Number(next[c.id]) || 0));
    if (shares) setPcts(Object.fromEntries(companies.map((c, i) => [c.id, String(shares[i])])));
  };

  // A typed percentage no longer follows the usage, so the usage is cleared
  // rather than saved beside figures it doesn't match.
  const setPctFor = (id: number, raw: string) => {
    setPcts((s) => ({ ...s, [id]: raw }));
    setUsage({});
  };

  const sum = companies.reduce((s, c) => s + (Number(pcts[c.id]) || 0), 0);
  const balanced = Math.abs(sum - 100) < 0.01;

  const spreadEvenly = () => {
    const share = Math.floor((100 / companies.length) * 100) / 100;
    const next: Record<number, string> = {};
    companies.forEach((c, i) => {
      // Give the remainder to the first company so it totals exactly 100.
      const v = i === 0 ? 100 - share * (companies.length - 1) : share;
      next[c.id] = String(Math.round(v * 100) / 100);
    });
    setPcts(next);
    setUsage({});
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Set the share each sub-company carries. The total must come to 100%. Or type each one&apos;s
        usage (e.g. pages printed) and the percentages work themselves out.
      </p>

      <div className="space-y-2 rounded-lg border border-line p-3">
        <div className="flex items-center justify-end gap-3 text-xs text-muted">
          <span className="w-24 text-right">Usage</span>
          <span className="w-28 pr-4 text-right">Share</span>
        </div>
        {companies.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3">
            <span className="flex-1 text-sm text-slate-700">{c.name}</span>
            <Input
              type="number"
              step="any"
              min="0"
              aria-label={`${c.name} usage`}
              placeholder="Usage"
              className="w-24 text-right"
              value={usage[c.id] ?? ""}
              onChange={(e) => setUsageFor(c.id, e.target.value)}
            />
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                className="w-24 text-right"
                aria-label={`${c.name} percentage`}
                value={pcts[c.id] ?? ""}
                onChange={(e) => setPctFor(c.id, e.target.value)}
              />
              <span className="text-sm text-muted">%</span>
            </div>
          </div>
        ))}
        <div
          className={cn(
            "flex items-center justify-between border-t border-line pt-2 text-sm",
            balanced ? "text-emerald-700" : "text-amber-700",
          )}
        >
          <span>Total</span>
          <span className="font-medium">{sum.toFixed(2)}%</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={spreadEvenly}>
          Spread evenly
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!balanced}
            onClick={() =>
              onSave(
                companies
                  .map((c) => {
                    const u = Number(usage[c.id]) || 0;
                    const percent = Number(pcts[c.id]) || 0;
                    return u > 0 ? { companyId: c.id, percent, usage: u } : { companyId: c.id, percent };
                  })
                  .filter((e) => e.percent > 0),
              )
            }
          >
            {balanced ? "Apply split" : `Must total 100% (${sum.toFixed(1)}%)`}
          </Button>
        </div>
      </div>
    </div>
  );
}
