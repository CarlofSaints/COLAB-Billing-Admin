"use client";

import { useState } from "react";
import { Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/field";
import { percentagesValid, percentSummary, type PercentEntry } from "@/lib/expense-accounts";
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
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Set the share each sub-company carries. The total must come to 100%.
      </p>

      <div className="space-y-2 rounded-lg border border-line p-3">
        {companies.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-700">{c.name}</span>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                className="w-24 text-right"
                value={pcts[c.id] ?? ""}
                onChange={(e) => setPcts((s) => ({ ...s, [c.id]: e.target.value }))}
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
                  .map((c) => ({ companyId: c.id, percent: Number(pcts[c.id]) || 0 }))
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
