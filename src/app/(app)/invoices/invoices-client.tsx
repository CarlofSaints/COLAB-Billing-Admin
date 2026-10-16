"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarRange,
  TriangleAlert,
  Info,
  CheckCircle2,
  Plus,
  Trash2,
  ChevronRight,
  FileText,
  RotateCcw,
  Send,
  Plug,
  Save,
  Undo2,
  Lock,
  LockOpen,
  BadgeCheck,
} from "lucide-react";
import {
  discardInvoiceDraft,
  generateInvoices,
  reopenInvoiceRun,
  saveInvoiceDraft,
  type GenerateResult,
} from "@/app/actions/invoices";
import type { SavedInvoiceCompany } from "@/db/schema";
import type { InvoicePreview, PreviewCompany } from "@/lib/invoice-engine";
import { mergeDraft, type LineChange, type MergedLine } from "@/lib/invoice-draft-merge";
import { RUN_TYPES, RUN_TYPE_LABELS, type RunType } from "@/lib/run-types";
import { periodLabel } from "@/lib/periods";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";

type EditableLine = {
  key: string;
  description: string;
  amount: string;
  detail: string[];
  change?: LineChange;
};
type EditableCompany = {
  companyId: number;
  name: string;
  xeroContactId: string | null;
  xeroContactName: string | null;
  lines: EditableLine[];
};

type SavedDraft = {
  companies: SavedInvoiceCompany[];
  calculatedTotal: number;
  savedAt: string;
  savedBy: string;
  finalisedAt: string | null;
  finalisedBy: string;
};

const CHANGE_LABELS: Record<LineChange, string> = {
  added: "New since the draft was saved",
  updated: "Updated from the calculation",
  gone: "No longer in the calculation",
};

/**
 * A draft is edits over the live calculation (mergeDraft). A Final run is shown
 * exactly as it was locked.
 */
function toEditable(companies: PreviewCompany[], saved: SavedDraft | null): EditableCompany[] {
  const savedById = new Map((saved?.companies ?? []).map((c) => [c.companyId, c]));
  return companies.map((c) => {
    const mine = savedById.get(c.companyId);
    const lines: MergedLine[] = saved?.finalisedAt ? (mine?.lines ?? c.lines) : mergeDraft(c.lines, mine);
    return {
      companyId: c.companyId,
      name: c.name,
      xeroContactId: c.xeroContactId,
      xeroContactName: c.xeroContactName,
      lines: lines.map((l) => ({
        key: l.key,
        description: l.description,
        amount: l.amount.toFixed(2),
        detail: l.detail,
        change: l.change,
      })),
    };
  });
}

/** The editor's full state as it is saved. "Unsaved changes" compares on this too. */
function toSaved(draft: EditableCompany[], calc: PreviewCompany[]): SavedInvoiceCompany[] {
  const calcById = new Map(calc.map((c) => [c.companyId, c.lines]));
  return draft.map((c) => ({
    companyId: c.companyId,
    lines: c.lines.map((l) => ({
      key: l.key,
      description: l.description,
      amount: Math.round((Number(l.amount) || 0) * 100) / 100,
      detail: l.detail,
    })),
    calculated: (calcById.get(c.companyId) ?? []).map(({ key, description, amount }) => ({
      key,
      description,
      amount,
    })),
  }));
}

export function InvoiceBuilder({
  preview,
  periods,
  canRun,
  xeroConnected,
  previousRun,
  runCount,
  saved,
}: {
  preview: InvoicePreview;
  periods: string[];
  canRun: boolean;
  xeroConnected: boolean;
  previousRun: {
    id: number;
    createdAt: string;
    createdBy: string;
    total: number;
    invoices: { companyName: string; invoiceNumber: string | null; error: string | null }[];
  } | null;
  runCount: number;
  saved: SavedDraft | null;
}) {
  const router = useRouter();
  const [state, action] = useActionState<GenerateResult, FormData>(generateInvoices, {});

  // Re-seed the editor whenever the server sends a different preview.
  const [seen, setSeen] = useState(preview);
  const [draft, setDraft] = useState<EditableCompany[]>(() => toEditable(preview.companies, saved));
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(toSaved(toEditable(preview.companies, saved), preview.companies)),
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  if (seen !== preview) {
    const seeded = toEditable(preview.companies, saved);
    setSeen(preview);
    setDraft(seeded);
    setBaseline(JSON.stringify(toSaved(seeded, preview.companies)));
  }

  const isFinal = Boolean(saved?.finalisedAt);
  const editable = canRun && !isFinal;
  const dirty = JSON.stringify(toSaved(draft, preview.companies)) !== baseline;
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  // A Final run is frozen, so a cost added since can't be on it.
  const finalIsStale =
    isFinal && saved !== null && Math.abs(saved.calculatedTotal - preview.grandTotal) >= 0.005;
  const changes = draft.flatMap((c) => c.lines.filter((l) => l.change).map((l) => l.change!));
  const countOf = (k: LineChange) => changes.filter((c) => c === k).length;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = (final: boolean) =>
    startSaving(async () => {
      setSaveError(null);
      const res = await saveInvoiceDraft({
        period: preview.period,
        runType: preview.runType,
        companies: toSaved(draft, preview.companies),
        calculatedTotal: preview.grandTotal,
        final,
      });
      if (res.error) setSaveError(res.error);
    });

  const reopen = () =>
    startSaving(async () => {
      setSaveError(null);
      const res = await reopenInvoiceRun({ period: preview.period, runType: preview.runType });
      if (res.error) setSaveError(res.error);
    });

  const goBackToCalculated = () => {
    if (!confirm("Throw away the saved changes and go back to the calculated figures?")) return;
    startSaving(async () => {
      setSaveError(null);
      const res = await discardInvoiceDraft({ period: preview.period, runType: preview.runType });
      if (res.error) setSaveError(res.error);
    });
  };

  const undoUnsaved = () => {
    const seeded = toEditable(preview.companies, saved);
    setDraft(seeded);
    setBaseline(JSON.stringify(toSaved(seeded, preview.companies)));
  };

  const totals = useMemo(
    () =>
      draft.map((c) => ({
        companyId: c.companyId,
        total: c.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0),
      })),
    [draft],
  );
  const grandTotal = totals.reduce((s, t) => s + t.total, 0);
  const totalFor = (companyId: number) =>
    totals.find((t) => t.companyId === companyId)?.total ?? 0;

  const setLine = (companyId: number, key: string, patch: Partial<EditableLine>) =>
    setDraft((d) =>
      d.map((c) =>
        c.companyId === companyId
          ? { ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }
          : c,
      ),
    );

  const removeLine = (companyId: number, key: string) =>
    setDraft((d) =>
      d.map((c) =>
        c.companyId === companyId ? { ...c, lines: c.lines.filter((l) => l.key !== key) } : c,
      ),
    );

  const addLine = (companyId: number) =>
    setDraft((d) =>
      d.map((c) =>
        c.companyId === companyId
          ? {
              ...c,
              lines: [
                ...c.lines,
                {
                  // Saved and reloaded now, so it must never collide with an earlier added line.
                  key: `manual-${c.companyId}-${Date.now()}`,
                  description: "",
                  amount: "0.00",
                  detail: ["Added by hand"],
                },
              ],
            }
          : c,
      ),
    );

  const billable = draft.filter((c) => totalFor(c.companyId) !== 0);
  const blocked = billable.filter((c) => !c.xeroContactId);
  const canSend = canRun && isFinal && xeroConnected && billable.length > 0 && blocked.length === 0;

  const switchTo = (next: { period?: string; run?: RunType }) => {
    if (dirty && !confirm("You have unsaved changes on this invoice run. Leave without saving them?")) {
      return;
    }
    const p = next.period ?? preview.period;
    const r = next.run ?? preview.runType;
    router.push(`/invoices?period=${p}&run=${r}`);
  };

  if (!xeroConnected) {
    return (
      <EmptyState
        icon={<Plug className="h-10 w-10" />}
        title="Xero isn't connected"
        description="Connect the COLAB organisation before running invoices."
        action={<Button onClick={() => router.push("/integrations")}>Go to Integrations</Button>}
      />
    );
  }

  return (
    <div className="space-y-4 pb-28">
      {/* Controls */}
      <Card>
        <CardHeader className="flex-col items-stretch gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CalendarRange className="h-4 w-4 text-muted" />
              <Select
                className="w-44"
                value={preview.period}
                onChange={(e) => switchTo({ period: e.target.value })}
              >
                {periods.map((p) => (
                  <option key={p} value={p}>
                    {periodLabel(p)}
                  </option>
                ))}
              </Select>
              <div className="flex gap-1 rounded-lg border border-line p-1">
                {RUN_TYPES.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => switchTo({ run: key })}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      preview.runType === key
                        ? "bg-brand-700 text-white"
                        : "text-slate-600 hover:bg-slate-100",
                    )}
                  >
                    {RUN_TYPE_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-muted">Invoice total</div>
              <div className="text-xl font-semibold text-slate-900">
                {formatCurrency(grandTotal)}
              </div>
            </div>
          </div>

          <p className="text-sm text-muted">
            {preview.runType === "recurring"
              ? "The static charges: rent split by effective floor space, plus the fixed line items. These don't depend on Xero actuals, so this run can go out at the start of the month."
              : "The variable costs actually incurred in Xero, split by your account and supplier mappings. Run this once the month is reconciled."}
          </p>
        </CardHeader>
      </Card>

      {/* Per-company totals, at a glance */}
      <Card>
        <CardContent className="py-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {draft.map((c) => {
              const total = totalFor(c.companyId);
              return (
                <div
                  key={c.companyId}
                  className="flex items-baseline justify-between gap-2 rounded-lg border border-line px-3 py-2"
                >
                  <span className="truncate text-sm font-medium text-slate-700">{c.name}</span>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-semibold tabular-nums",
                      total > 0 ? "text-slate-900" : "text-muted",
                    )}
                  >
                    {total > 0 ? formatCurrency(total) : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Saved changes */}
      {saved && isFinal && (
        <div
          className={cn(
            "flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm",
            finalIsStale
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800",
          )}
        >
          {finalIsStale ? (
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Final. Marked by {saved.finalisedBy} on {formatDateTime(saved.finalisedAt!)}. Locked, ready
              to send to Xero.
            </p>
            {finalIsStale && (
              <p className="mt-0.5">
                The calculation has changed since then ({formatCurrency(saved.calculatedTotal)} to{" "}
                {formatCurrency(preview.grandTotal)}), so a cost may be missing. Reopen as a draft to pick
                it up.
              </p>
            )}
          </div>
          {canRun && (
            <Button variant="ghost" size="sm" onClick={reopen} disabled={saving}>
              <LockOpen className="h-3.5 w-3.5" /> Reopen as draft
            </Button>
          )}
        </div>
      )}
      {saved && !isFinal && (
        <div
          className={cn(
            "flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm",
            changes.length > 0
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-line bg-slate-50 text-slate-600",
          )}
        >
          <Save className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>
              Draft, last saved by {saved.savedBy} on {formatDateTime(saved.savedAt)}. Edits are kept;
              everything else follows the calculation.
            </p>
            {changes.length > 0 && (
              <p className="mt-0.5">
                Since then:{" "}
                {(["added", "updated", "gone"] as const)
                  .filter((k) => countOf(k) > 0)
                  .map((k) => `${countOf(k)} ${k === "added" ? "new" : k === "updated" ? "updated" : "no longer calculated"}`)
                  .join(", ")}
                . They&apos;re highlighted below. Check them, then save.
              </p>
            )}
          </div>
          {canRun && (
            <Button variant="ghost" size="sm" onClick={goBackToCalculated} disabled={saving}>
              <Undo2 className="h-3.5 w-3.5" /> Go back to calculated figures
            </Button>
          )}
        </div>
      )}

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div className="space-y-2">
          {preview.warnings.map((w, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
                w.level === "warn"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-line bg-slate-50 text-slate-600",
              )}
            >
              {w.level === "warn" ? (
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div className="flex-1">
                {w.message}
                {w.href && (
                  <Link
                    href={w.href}
                    className="ml-2 font-medium underline underline-offset-2 hover:no-underline"
                  >
                    {w.linkLabel ?? "Open"}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Already sent */}
      {previousRun && (
        <div className="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">
              {runCount === 1 ? "This run has already been sent once." : `This run has been sent ${runCount} times.`}
            </p>
            <p className="mt-0.5">
              Last on {formatDateTime(previousRun.createdAt)} by {previousRun.createdBy} —{" "}
              {formatCurrency(previousRun.total)}:{" "}
              {previousRun.invoices
                .map((i) => `${i.companyName} ${i.invoiceNumber ?? "(failed)"}`)
                .join(", ")}
              . Sending again creates a second set of drafts in Xero.
            </p>
          </div>
        </div>
      )}

      {/* Result */}
      {(state.created?.length || state.failed?.length || state.error || saveError) && (
        <div className="space-y-2">
          {saveError && (
            <p className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              <TriangleAlert className="h-4 w-4" /> {saveError}
            </p>
          )}
          {state.error && (
            <p className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              <TriangleAlert className="h-4 w-4" /> {state.error}
            </p>
          )}
          {state.created && state.created.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              Created {state.created.length} draft invoice(s) in Xero:{" "}
              {state.created.map((c) => `${c.company} ${c.invoiceNumber ?? ""}`.trim()).join(", ")}.
            </p>
          )}
          {state.failed && state.failed.length > 0 && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-medium">Some invoices didn&apos;t go through:</p>
              <ul className="mt-1 list-inside list-disc">
                {state.failed.map((f, i) => (
                  <li key={i}>
                    {f.company}: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Per-company invoices */}
      {billable.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title="Nothing to bill for this month"
          description={
            preview.runType === "recurring"
              ? "No rent or fixed line items are configured."
              : "No supplier spend was split to a sub-company for this month."
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {draft.map((c) => {
            const total = totalFor(c.companyId);
            return (
              <Card key={c.companyId} className={cn(total === 0 && "opacity-60")}>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle>{c.name}</CardTitle>
                    <CardDescription className="flex items-center gap-1.5">
                      {c.xeroContactId ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          {c.xeroContactName}
                        </>
                      ) : (
                        <>
                          <TriangleAlert className="h-3.5 w-3.5 text-amber-600" />
                          No Xero contact linked
                        </>
                      )}
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-slate-900">
                      {formatCurrency(total)}
                    </div>
                    <div className="text-xs text-muted">excl. VAT</div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  {c.lines.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted">No lines.</p>
                  )}
                  {c.lines.map((l) => {
                    const id = `${c.companyId}:${l.key}`;
                    const open = expanded === id;
                    return (
                      <div
                        key={l.key}
                        className={cn(
                          "rounded-lg border",
                          l.change ? "border-amber-300 bg-amber-50/60" : "border-line",
                        )}
                      >
                        {l.change && (
                          <p className="px-3 pt-1.5 text-xs font-medium text-amber-700">
                            {CHANGE_LABELS[l.change]}
                          </p>
                        )}
                        <div className="flex items-center gap-2 p-2">
                          <button
                            type="button"
                            onClick={() => setExpanded(open ? null : id)}
                            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100"
                            title="How this was worked out"
                          >
                            <ChevronRight
                              className={cn("h-4 w-4 transition-transform", open && "rotate-90")}
                            />
                          </button>
                          <Input
                            value={l.description}
                            disabled={!editable}
                            placeholder="Description"
                            onChange={(e) =>
                              setLine(c.companyId, l.key, { description: e.target.value })
                            }
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            step="0.01"
                            value={l.amount}
                            disabled={!editable}
                            onChange={(e) => setLine(c.companyId, l.key, { amount: e.target.value })}
                            className="w-32 text-right tabular-nums"
                          />
                          {editable && (
                            <button
                              type="button"
                              onClick={() => removeLine(c.companyId, l.key)}
                              className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              title="Remove line"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {open && l.detail.length > 0 && (
                          <ul className="space-y-0.5 border-t border-line bg-slate-50 px-4 py-2 text-xs text-muted">
                            {l.detail.map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                  {editable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1"
                      onClick={() => addLine(c.companyId)}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add line
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Send bar */}
      {canRun && (billable.length > 0 || dirty) && (
        <form action={action}>
          <input type="hidden" name="period" value={preview.period} />
          <input type="hidden" name="runType" value={preview.runType} />
          <SendBar
            dirty={dirty}
            saving={saving}
            isFinal={isFinal}
            onSave={() => save(false)}
            onFinalise={() => save(true)}
            onReopen={reopen}
            onUndo={undoUnsaved}
            count={billable.length}
            total={grandTotal}
            blocked={blocked.map((c) => c.name)}
            canSend={canSend}
            period={preview.period}
            repeat={runCount > 0}
          />
        </form>
      )}
    </div>
  );
}

function SendBar({
  dirty,
  saving,
  isFinal,
  onSave,
  onFinalise,
  onReopen,
  onUndo,
  count,
  total,
  blocked,
  canSend,
  period,
  repeat,
}: {
  dirty: boolean;
  saving: boolean;
  isFinal: boolean;
  onSave: () => void;
  onFinalise: () => void;
  onReopen: () => void;
  onUndo: () => void;
  count: number;
  total: number;
  blocked: string[];
  canSend: boolean;
  period: string;
  repeat: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <div className="fixed bottom-0 left-64 right-0 z-20 border-t border-line bg-white/95 px-6 py-3 shadow-[0_-2px_10px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="mr-auto text-sm">
          {blocked.length > 0 ? (
            <span className="flex items-center gap-2 text-amber-700">
              <TriangleAlert className="h-4 w-4" />
              {blocked.join(", ")} {blocked.length === 1 ? "has" : "have"} no Xero contact — link{" "}
              {blocked.length === 1 ? "it" : "them"} first.
            </span>
          ) : (
            <span className="text-slate-600">
              {count} invoice{count === 1 ? "" : "s"} · {formatCurrency(total)} excl. VAT ·{" "}
              {periodLabel(period)}
            </span>
          )}
        </div>
        {dirty && (
          <>
            <span className="text-sm font-medium text-amber-700">Unsaved changes</span>
            <Button type="button" variant="ghost" onClick={onUndo} disabled={saving || pending}>
              <Undo2 className="h-4 w-4" /> Undo changes
            </Button>
          </>
        )}
        {isFinal ? (
          <Button type="button" variant="outline" onClick={onReopen} disabled={saving || pending}>
            <LockOpen className="h-4 w-4" /> Reopen as draft
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={onSave}
              disabled={!dirty || saving || pending}
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : dirty ? "Save draft" : "Draft saved"}
            </Button>
            <Button type="button" onClick={onFinalise} disabled={saving || pending}>
              <BadgeCheck className="h-4 w-4" /> Mark as final
            </Button>
          </>
        )}
        <Button
          type="submit"
          disabled={!canSend || pending}
          title={isFinal ? undefined : "Mark the run as final first"}
          onClick={(e) => {
            if (
              repeat &&
              !confirm(
                `Invoices for ${periodLabel(period)} have already been sent to Xero.\n\nSending again creates a SECOND set of drafts. Continue?`,
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <Send className="h-4 w-4" />
          {pending ? "Sending to Xero…" : "Generate in Xero as a draft"}
        </Button>
      </div>
    </div>
  );
}
