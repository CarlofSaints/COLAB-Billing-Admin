"use client";

import { useState } from "react";
import { Layers, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { fixedItemLabel, type FixedItemOption } from "@/lib/expense-accounts";
import { formatCurrency, cn } from "@/lib/utils";

/**
 * The "Applies to" cell for a rule that recovers Static line items before
 * splitting whatever is left.
 *
 * ⚠️ It takes SEVERAL items, not one. A single supplier bill is routinely
 * pre-billed by more than one item — Yaxxa's covers VOIP handsets by tag,
 * licences by tag and Fibre&MW per head — and naming only one leaves the
 * balance overstated by every other, which then gets charged a second time.
 *
 * Shared by the expense-account grid, the supplier grid and creditor links so
 * all three agree on what "recovered" means.
 */
export function RecoveryItemsCell({
  value,
  items,
  disabled,
  emptyLabel = "No items — nothing is recovered",
  onChange,
}: {
  value: number[];
  items: FixedItemOption[];
  disabled?: boolean;
  /** What the button says when nothing is picked. */
  emptyLabel?: string;
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const picked = items.filter((i) => value.includes(i.id));
  // An id with no item behind it recovers nothing and quietly over-charges,
  // so it gets called out rather than just disappearing from the list.
  const orphans = value.filter((id) => !items.some((i) => i.id === id));

  const summary =
    picked.length === 0
      ? emptyLabel
      : picked.length === 1
        ? picked[0].name
        : `${picked[0].name} + ${picked.length - 1} more`;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default",
          orphans.length > 0
            ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
            : picked.length > 0
              ? "border-line bg-white text-slate-700 hover:bg-slate-50"
              : "border-line bg-white text-muted hover:bg-slate-50",
        )}
      >
        <span className="flex items-center gap-1.5">
          {orphans.length > 0 ? (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Layers className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">
            {orphans.length > 0 ? `${orphans.length} item(s) no longer exist` : summary}
          </span>
        </span>
      </button>

      {open && (
        <Modal
          title="Which items already recover this?"
          open
          onOpenChange={(o) => !o && setOpen(false)}
        >
          <RecoveryItemsForm
            value={value}
            items={items}
            onCancel={() => setOpen(false)}
            onSave={(ids) => {
              onChange(ids);
              setOpen(false);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function RecoveryItemsForm({
  value,
  items,
  onSave,
  onCancel,
}: {
  value: number[];
  items: FixedItemOption[];
  onSave: (ids: number[]) => void;
  onCancel: () => void;
}) {
  const [ids, setIds] = useState<number[]>(value);
  const toggle = (id: number) =>
    setIds((prev) => (prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]));

  const picked = items.filter((i) => ids.includes(i.id));
  // Restricted items hide their amount, so the total would be a lie — say it
  // is partial rather than print a number that is quietly missing a line.
  const anyRestricted = picked.some((i) => i.allocatedTotal === null);
  const total = picked.reduce((s, i) => s + (i.allocatedTotal ?? 0), 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Tick every fixed line item that already bills part of this cost on the Static invoice.
        Their total is deducted, and whatever is left over is split by the balance rule.
      </p>

      <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted">
            No fixed line items exist yet — add them under Controls.
          </p>
        ) : (
          items.map((i) => (
            <label
              key={i.id}
              className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={ids.includes(i.id)}
                onChange={() => toggle(i.id)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-line"
              />
              <span className="min-w-0 text-sm text-slate-700">
                {fixedItemLabel(i, formatCurrency)}
                {i.allocatedTotal !== null && (
                  <span className="ml-1 text-muted">
                    · bills {formatCurrency(i.allocatedTotal)}
                  </span>
                )}
              </span>
            </label>
          ))
        )}
      </div>

      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-sm",
          ids.length > 0
            ? "border-line bg-slate-50 text-slate-700"
            : "border-amber-300 bg-amber-50 text-amber-800",
        )}
      >
        {ids.length === 0 ? (
          "Nothing ticked — the whole amount will be treated as the balance."
        ) : (
          <>
            {ids.length} item{ids.length === 1 ? "" : "s"} recovering{" "}
            <strong>{anyRestricted ? "an amount that is partly restricted" : formatCurrency(total)}</strong>
            {" "}on the Static invoice.
          </>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => onSave(ids)}>
          Use these items
        </Button>
      </div>
    </div>
  );
}
