"use client";

import { useActionState, useMemo, useState } from "react";
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
} from "lucide-react";
import { generateInvoices, type GenerateResult } from "@/app/actions/invoices";
import type { InvoicePreview, PreviewCompany, RunType } from "@/lib/invoice-engine";
import { periodLabel } from "@/lib/periods";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";

type EditableLine = { key: string; description: string; amount: string; detail: string[] };
type EditableCompany = {
  companyId: number;
  name: string;
  xeroContactId: string | null;
  xeroContactName: string | null;
  lines: EditableLine[];
};

function toEditable(companies: PreviewCompany[]): EditableCompany[] {
  return companies.map((c) => ({
    companyId: c.companyId,
    name: c.name,
    xeroContactId: c.xeroContactId,
    xeroContactName: c.xeroContactName,
    lines: c.lines.map((l) => ({
      key: l.key,
      description: l.description,
      amount: l.amount.toFixed(2),
      detail: l.detail,
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
}) {
  const router = useRouter();
  const [state, action] = useActionState<GenerateResult, FormData>(generateInvoices, {});

  // Re-seed the editor whenever the server sends a different preview.
  const [seen, setSeen] = useState(preview);
  const [draft, setDraft] = useState<EditableCompany[]>(() => toEditable(preview.companies));
  const [expanded, setExpanded] = useState<string | null>(null);
  if (seen !== preview) {
    setSeen(preview);
    setDraft(toEditable(preview.companies));
  }

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
                  key: `manual-${c.companyId}-${c.lines.length}-${c.lines.reduce((s, l) => s + l.key.length, 0)}`,
                  description: "",
                  amount: "0.00",
                  detail: ["Added by hand"],
                },
              ],
            }
          : c,
      ),
    );

  const payload = JSON.stringify(
    draft.map((c) => ({
      companyId: c.companyId,
      lines: c.lines
        .filter((l) => l.description.trim() && Number(l.amount))
        .map((l) => ({ description: l.description.trim(), amount: Number(l.amount) })),
    })),
  );

  const billable = draft.filter((c) => totalFor(c.companyId) !== 0);
  const blocked = billable.filter((c) => !c.xeroContactId);
  const canSend = canRun && xeroConnected && billable.length > 0 && blocked.length === 0;

  const switchTo = (next: { period?: string; run?: RunType }) => {
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
                {(
                  [
                    { key: "recurring", label: "Recurring" },
                    { key: "month_end", label: "Month-end" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => switchTo({ run: t.key })}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      preview.runType === t.key
                        ? "bg-brand-700 text-white"
                        : "text-slate-600 hover:bg-slate-100",
                    )}
                  >
                    {t.label}
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
              ? "The predictable charges: rent split by effective floor space, plus the fixed line items. These don't depend on Xero actuals, so this run can go out at the start of the month."
              : "The variable costs actually incurred in Xero, split by your account and supplier mappings. Run this once the month is reconciled."}
          </p>
        </CardHeader>
      </Card>

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
      {(state.created?.length || state.failed?.length || state.error) && (
        <div className="space-y-2">
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
                      <div key={l.key} className="rounded-lg border border-line">
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
                            disabled={!canRun}
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
                            disabled={!canRun}
                            onChange={(e) => setLine(c.companyId, l.key, { amount: e.target.value })}
                            className="w-32 text-right tabular-nums"
                          />
                          {canRun && (
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
                  {canRun && (
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
      {canRun && billable.length > 0 && (
        <form action={action}>
          <input type="hidden" name="period" value={preview.period} />
          <input type="hidden" name="runType" value={preview.runType} />
          <input type="hidden" name="invoices" value={payload} />
          <SendBar
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
  count,
  total,
  blocked,
  canSend,
  period,
  repeat,
}: {
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
        <Button
          type="submit"
          disabled={!canSend || pending}
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
