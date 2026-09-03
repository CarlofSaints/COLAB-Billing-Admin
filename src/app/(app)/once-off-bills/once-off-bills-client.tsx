"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarRange,
  ChevronRight,
  Copy,
  Info,
  Pencil,
  Plus,
  Receipt,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  copyOnceOffBill,
  deleteOnceOffBill,
  saveOnceOffBill,
  submitOnceOffBill,
  type BillState,
} from "@/app/actions/once-off-bills";
import {
  FIXED_SPLIT_MODES,
  deriveFixedShares,
  fixedAllocationAmount,
  fixedSplitModeLabel,
  isDerivedMode,
  isPercentShaped,
  type FixedSplitBasis,
  type FixedSplitMode,
} from "@/lib/billing-calc";
import { periodLabel } from "@/lib/periods";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";

export type BillCompany = { id: number; name: string };

export type BillRow = {
  id: number;
  description: string;
  period: string;
  periodLabel: string;
  splitMode: FixedSplitMode;
  unitAmount: number;
  notes: string | null;
  status: "draft" | "submitted";
  createdByName: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  copiedFromId: number | null;
  createdAt: string;
  quantity: number | null;
  total: number;
  allocations: { companyId: number; quantity: number }[];
  lines: { companyId: number; share: number; amount: number }[];
};

export function OnceOffBillsClient({
  bills,
  companies,
  basis,
  months,
  filterPeriod,
  canManage,
  notify,
}: {
  bills: BillRow[];
  companies: BillCompany[];
  basis: FixedSplitBasis;
  months: string[];
  filterPeriod: string | null;
  canManage: boolean;
  notify: { groupName: string | null; recipientCount: number; personName: string | null };
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BillRow | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<{ bill: BillRow; kind: "submit" | "delete" } | null>(
    null,
  );
  // What the last copy/submit/delete did, shown once and then dismissed by the
  // next action. These run outside a form, so there is no `useActionState`
  // result to render.
  const [flash, setFlash] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const companyName = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies],
  );

  const drafts = bills.filter((b) => b.status === "draft");
  const submitted = bills.filter((b) => b.status === "submitted");
  const submittedTotal = submitted.reduce((s, b) => s + b.total, 0);

  const run = (fn: () => Promise<BillState>) =>
    start(async () => {
      const res = await fn();
      setConfirming(null);
      setFlash(
        res.error ? { tone: "bad", text: res.error } : { tone: "ok", text: res.note ?? "Done." },
      );
      router.refresh();
    });

  const switchPeriod = (value: string) =>
    router.push(value ? `/once-off-bills?period=${value}` : "/once-off-bills");

  return (
    <div className="space-y-4">
      {/* ---- Filter + add ------------------------------------------- */}
      <Card>
        <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted" />
            <Select
              className="w-48"
              value={filterPeriod ?? ""}
              onChange={(e) => switchPeriod(e.target.value)}
            >
              <option value="">Every month</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {periodLabel(m)}
                </option>
              ))}
            </Select>
            <span className="text-sm text-muted">
              {bills.length} bill{bills.length === 1 ? "" : "s"}
              {submitted.length > 0 && (
                <> · {formatCurrency(submittedTotal)} submitted</>
              )}
            </span>
          </div>
          {canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              New once-off bill
            </Button>
          )}
        </CardHeader>
      </Card>

      {flash && (
        <p
          className={cn(
            "rounded-lg px-4 py-3 text-sm",
            flash.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700",
          )}
        >
          {flash.text}
        </p>
      )}

      {/* ---- Who gets told ------------------------------------------ */}
      <NotifyNote notify={notify} />

      {/* ---- The bills ---------------------------------------------- */}
      {bills.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-10 w-10" />}
          title={filterPeriod ? `No once-off bills for ${periodLabel(filterPeriod)}` : "No once-off bills yet"}
          description="A once-off bill is a cost that happens in one month only — 40 chairs, a team lunch, a repair. Add one, split it, and submit it to that month's Variable invoice run."
          action={
            canManage ? (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                New once-off bill
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Bills</CardTitle>
              <CardDescription>
                {drafts.length} draft{drafts.length === 1 ? "" : "s"} · {submitted.length} submitted.
                Only submitted bills reach an invoice.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <THead>
                <tr>
                  <TH className="w-8" />
                  <TH>Description</TH>
                  <TH>Month</TH>
                  <TH>Split</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Cost per item</TH>
                  <TH className="text-right">Total</TH>
                  <TH>Status</TH>
                  {canManage && <TH className="text-right">Actions</TH>}
                </tr>
              </THead>
              <tbody>
                {bills.map((b) => (
                  <BillRowView
                    key={b.id}
                    bill={b}
                    companyName={companyName}
                    expanded={expanded === b.id}
                    onToggle={() => setExpanded(expanded === b.id ? null : b.id)}
                    canManage={canManage}
                    pending={pending}
                    onEdit={() => setEditing(b)}
                    onCopy={() => run(() => copyOnceOffBill(b.id))}
                    onSubmit={() => setConfirming({ bill: b, kind: "submit" })}
                    onDelete={() => setConfirming({ bill: b, kind: "delete" })}
                  />
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ---- Add / edit --------------------------------------------- */}
      <Modal
        title="New once-off bill"
        description="It saves as a draft. Nothing is invoiced until you submit it."
        open={adding}
        onOpenChange={setAdding}
        wide
      >
        <BillForm
          companies={companies}
          basis={basis}
          months={months}
          defaultPeriod={filterPeriod}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      </Modal>

      <Modal
        title={`Edit ${editing?.description ?? ""}`}
        open={editing != null}
        onOpenChange={(o) => !o && setEditing(null)}
        wide
      >
        {editing && (
          <BillForm
            bill={editing}
            companies={companies}
            basis={basis}
            months={months}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </Modal>

      {/* ---- Confirm submit / delete -------------------------------- */}
      <Modal
        title={
          confirming?.kind === "submit" ? "Submit to the invoice run?" : "Delete this bill?"
        }
        open={confirming != null}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        {confirming && (
          <ConfirmBody
            bill={confirming.bill}
            kind={confirming.kind}
            companyName={companyName}
            notify={notify}
            pending={pending}
            onCancel={() => setConfirming(null)}
            onConfirm={() =>
              run(() =>
                confirming.kind === "submit"
                  ? submitOnceOffBill(confirming.bill.id)
                  : deleteOnceOffBill(confirming.bill.id),
              )
            }
          />
        )}
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Who a submission emails                                              */
/* -------------------------------------------------------------------- */

/**
 * A notification pointing at nothing is this page's most likely quiet failure:
 * everything looks configured and nobody is told. So the answer is on the page
 * rather than one click away, and it warns when the group resolves to zero
 * people — which a rule group silently does the moment its tag is renamed.
 */
function NotifyNote({
  notify,
}: {
  notify: { groupName: string | null; recipientCount: number; personName: string | null };
}) {
  const { groupName, recipientCount, personName } = notify;
  const nobody = !groupName && !personName;
  const emptyGroup = groupName != null && recipientCount === 0;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-4 py-3 text-sm",
        nobody || emptyGroup ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600",
      )}
    >
      {nobody || emptyGroup ? (
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      )}
      <p>
        {nobody ? (
          <>
            Submitting a bill emails whoever created it, and <strong>nobody else</strong> — no
            group or person is set for it yet.
          </>
        ) : emptyGroup ? (
          <>
            Submitting emails whoever created it, plus the group{" "}
            <strong>{groupName}</strong> — which currently matches{" "}
            <strong>nobody with an email address</strong>.
          </>
        ) : (
          <>
            Submitting emails whoever created it
            {groupName && (
              <>
                , plus <strong>{groupName}</strong> ({recipientCount}{" "}
                {recipientCount === 1 ? "person" : "people"})
              </>
            )}
            {personName && <> and <strong>{personName}</strong></>}.
          </>
        )}{" "}
        <Link href="/notifications" className="font-medium text-brand-700 underline">
          Change who is told
        </Link>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* One row                                                              */
/* -------------------------------------------------------------------- */

function BillRowView({
  bill,
  companyName,
  expanded,
  onToggle,
  canManage,
  pending,
  onEdit,
  onCopy,
  onSubmit,
  onDelete,
}: {
  bill: BillRow;
  companyName: Map<number, string>;
  expanded: boolean;
  onToggle: () => void;
  canManage: boolean;
  pending: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onSubmit: () => void;
  onDelete: () => void;
}) {
  const isDraft = bill.status === "draft";
  const cols = canManage ? 9 : 8;

  return (
    <>
      <TR>
        <TD className="pr-0">
          <button
            type="button"
            onClick={onToggle}
            className="rounded p-1 text-muted hover:bg-slate-100"
            aria-label={expanded ? "Hide the split" : "Show the split"}
          >
            <ChevronRight
              className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")}
            />
          </button>
        </TD>
        <TD>
          <span className="font-medium text-slate-900">{bill.description}</span>
          {bill.copiedFromId && (
            <span className="ml-2 text-xs text-muted">(copy)</span>
          )}
          {bill.notes && <p className="mt-0.5 text-xs text-muted">{bill.notes}</p>}
        </TD>
        <TD>{bill.periodLabel}</TD>
        <TD className="text-slate-600">{fixedSplitModeLabel(bill.splitMode)}</TD>
        <TD className="text-right tabular-nums">
          {bill.quantity === null ? <span className="text-muted">—</span> : bill.quantity}
        </TD>
        <TD className="text-right tabular-nums">{formatCurrency(bill.unitAmount)}</TD>
        <TD className="text-right font-medium tabular-nums">{formatCurrency(bill.total)}</TD>
        <TD>
          {isDraft ? (
            <Badge tone="amber">Draft</Badge>
          ) : (
            <Badge tone="green">Submitted</Badge>
          )}
        </TD>
        {canManage && (
          <TD className="text-right">
            <div className="flex items-center justify-end gap-1">
              {isDraft && (
                <>
                  <Button variant="ghost" size="sm" title="Edit" onClick={onEdit}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    title="Submit to the invoice run"
                    disabled={pending}
                    onClick={onSubmit}
                  >
                    <Send className="h-3.5 w-3.5" />
                    Submit
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                title="Copy to next month"
                disabled={pending}
                onClick={onCopy}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" title="Delete" disabled={pending} onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5 text-red-600" />
              </Button>
            </div>
          </TD>
        )}
      </TR>
      {expanded && (
        <TR>
          <TD colSpan={cols} className="bg-slate-50">
            <div className="space-y-1.5 px-2 py-1">
              {bill.lines.length === 0 ? (
                <p className="text-sm text-amber-700">
                  This bill works out to nothing on today&rsquo;s numbers — check the split and the
                  quantities.
                </p>
              ) : (
                bill.lines.map((l) => (
                  <div key={l.companyId} className="flex justify-between gap-4 text-sm">
                    <span className="text-slate-700">
                      {companyName.get(l.companyId) ?? `Company ${l.companyId}`}
                      <span className="ml-2 text-xs text-muted">
                        {isPercentShaped(bill.splitMode)
                          ? `${Math.round(l.share * 10) / 10}% of ${formatCurrency(bill.unitAmount)}`
                          : `${l.share} × ${formatCurrency(bill.unitAmount)}`}
                      </span>
                    </span>
                    <span className="tabular-nums text-slate-900">{formatCurrency(l.amount)}</span>
                  </div>
                ))
              )}
              <p className="border-t border-line pt-2 text-xs text-muted">
                Created by {bill.createdByName ?? "someone"} on {formatDateTime(bill.createdAt)}
                {bill.submittedAt && (
                  <>
                    {" "}
                    · Submitted by {bill.submittedByName ?? "someone"} on{" "}
                    {formatDateTime(bill.submittedAt)}
                  </>
                )}
              </p>
            </div>
          </TD>
        </TR>
      )}
    </>
  );
}

/* -------------------------------------------------------------------- */
/* Confirm                                                              */
/* -------------------------------------------------------------------- */

function ConfirmBody({
  bill,
  kind,
  companyName,
  notify,
  pending,
  onCancel,
  onConfirm,
}: {
  bill: BillRow;
  kind: "submit" | "delete";
  companyName: Map<number, string>;
  notify: { groupName: string | null; recipientCount: number; personName: string | null };
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line p-3">
        <p className="font-medium text-slate-900">{bill.description}</p>
        <p className="text-sm text-muted">
          {bill.periodLabel} · {fixedSplitModeLabel(bill.splitMode)} ·{" "}
          <span className="tabular-nums">{formatCurrency(bill.total)}</span>
        </p>
        <div className="mt-2 space-y-1 border-t border-line pt-2">
          {bill.lines.map((l) => (
            <div key={l.companyId} className="flex justify-between text-sm">
              <span className="text-slate-700">
                {companyName.get(l.companyId) ?? `Company ${l.companyId}`}
              </span>
              <span className="tabular-nums text-slate-900">{formatCurrency(l.amount)}</span>
            </div>
          ))}
        </div>
      </div>

      {kind === "submit" ? (
        <>
          <p className="text-sm text-slate-700">
            This adds the bill to the <strong>Variable</strong> invoice run for{" "}
            <strong>{bill.periodLabel}</strong>. It does not create anything in Xero — the
            invoices are still generated by hand from the Invoice Run page.
          </p>
          <p className="text-sm text-slate-700">
            An email goes to whoever created it
            {notify.groupName && (
              <>
                {" "}
                and to <strong>{notify.groupName}</strong> ({notify.recipientCount}{" "}
                {notify.recipientCount === 1 ? "person" : "people"})
              </>
            )}
            {notify.personName && <> and <strong>{notify.personName}</strong></>}.
          </p>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            A submitted bill can&rsquo;t be edited — the amount may already be on a preview
            somebody is about to send. To change it, delete it and submit a new one.
          </p>
        </>
      ) : (
        <p
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            bill.status === "submitted"
              ? "bg-amber-50 text-amber-800"
              : "bg-slate-50 text-slate-600",
          )}
        >
          {bill.status === "submitted"
            ? "This bill has been submitted. Deleting it takes it off the Variable run — but if that run has already been pushed to Xero, the draft invoice there still carries the line and has to be fixed in Xero."
            : "This is a draft, so nothing has been invoiced. Deleting it removes it for good."}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={kind === "delete" ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={pending}
        >
          {kind === "submit"
            ? pending
              ? "Submitting…"
              : "Submit to invoice run"
            : pending
              ? "Deleting…"
              : "Delete"}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* The form                                                             */
/* -------------------------------------------------------------------- */

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Add or edit a bill.
 *
 * Deliberately the same shape as `FixedItemForm` in controls-client — same
 * split dropdown, same tick-a-company-and-set-a-quantity list, same live
 * preview of the derived shares. Somebody who can add a fixed line item can
 * already use this, and the two produce identical splits because they call the
 * same functions.
 */
function BillForm({
  bill,
  companies,
  basis,
  months,
  defaultPeriod,
  onDone,
}: {
  bill?: BillRow;
  companies: BillCompany[];
  basis: FixedSplitBasis;
  months: string[];
  defaultPeriod?: string | null;
  onDone: () => void;
}) {
  const [state, action] = useActionState<BillState, FormData>(saveOnceOffBill, {});
  const [mode, setMode] = useState<FixedSplitMode>(bill?.splitMode ?? "quantity");
  const [unitAmount, setUnitAmount] = useState(String(bill?.unitAmount ?? ""));
  const [selected, setSelected] = useState<Set<number>>(
    new Set(bill?.allocations.map((a) => a.companyId) ?? []),
  );
  const [qty, setQty] = useState<Record<number, string>>(
    Object.fromEntries(
      companies.map((c) => [
        c.id,
        (bill?.allocations.find((a) => a.companyId === c.id)?.quantity ?? 1).toString(),
      ]),
    ),
  );

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const modeSpec = FIXED_SPLIT_MODES.find((m) => m.key === mode);
  const percentShaped = isPercentShaped(mode);
  const derived = isDerivedMode(mode);

  // A direct split goes to exactly one company. Narrowed here rather than
  // corrected in an effect, so the earlier ticks come back if they change mode.
  const active = useMemo(
    () => (mode === "direct" && selected.size > 1 ? new Set([[...selected][0]]) : selected),
    [mode, selected],
  );

  const derivedShares = useMemo(
    () =>
      derived
        ? deriveFixedShares(
            mode,
            companies.filter((c) => active.has(c.id)).map((c) => c.id),
            basis,
          )
        : {},
    [derived, mode, companies, active, basis],
  );
  const derivedEmpty = derived && Object.keys(derivedShares).length === 0 && active.size > 0;

  const percentTotal = companies
    .filter((c) => active.has(c.id))
    .reduce((s, c) => s + (Number(qty[c.id]) || 0), 0);
  const percentBalanced = Math.abs(percentTotal - 100) < 0.01;

  // The quantity Carl asked for as its own field, shown as the SUM of the
  // per-company quantities rather than typed in separately. Two boxes for one
  // number is two numbers that can disagree, and the one that would win is the
  // one nobody typed.
  const totalQuantity = companies
    .filter((c) => active.has(c.id))
    .reduce((s, c) => s + (Number(qty[c.id]) || 0), 0);

  const unit = Number(unitAmount) || 0;
  const previewTotal = percentShaped
    ? companies
        .filter((c) => active.has(c.id))
        .reduce(
          (s, c) =>
            s +
            fixedAllocationAmount(
              { splitMode: mode, unitAmount: unit },
              derived ? (derivedShares[c.id] ?? 0) : Number(qty[c.id]) || 0,
            ),
          0,
        )
    : Math.round(totalQuantity * unit * 100) / 100;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (mode === "direct") return next.has(id) ? new Set() : new Set([id]);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <form action={action} className="space-y-4">
      {bill && <input type="hidden" name="id" value={bill.id} />}
      <input type="hidden" name="splitMode" value={mode} />

      <Field label="Description">
        <Input
          name="description"
          defaultValue={bill?.description}
          placeholder="e.g. Office chairs"
          required
          autoFocus
          maxLength={200}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Month to invoice"
          hint="It goes on the Variable run for this month."
        >
          <Select name="period" defaultValue={bill?.period ?? defaultPeriod ?? months[3]} required>
            {months.map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Invoice run">
          <Input value="Variable" disabled readOnly />
          <p className="mt-1 text-xs text-muted">
            Once-off bills always go on the Variable run — the Static run is rent and the fixed
            monthly items.
          </p>
        </Field>
      </div>

      <Field label="How is it split?" hint={modeSpec?.hint}>
        <Select value={mode} onChange={(e) => setMode(e.target.value as FixedSplitMode)}>
          {FIXED_SPLIT_MODES.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={percentShaped ? "Total amount (excl. VAT)" : "Cost per item (excl. VAT)"}
          hint={percentShaped ? "The whole cost, before it's divided." : "The price of one."}
        >
          <Input
            name="unitAmount"
            type="number"
            step="0.01"
            min="0"
            value={unitAmount}
            onChange={(e) => setUnitAmount(e.target.value)}
            required
          />
        </Field>
        <Field
          label="Quantity"
          hint={
            percentShaped
              ? "Not used on a percentage split — the whole cost is divided instead."
              : "Adds up the quantities you set per sub-company below."
          }
        >
          <Input
            value={percentShaped ? "—" : String(Math.round(totalQuantity * 100) / 100)}
            disabled
            readOnly
            className="text-right tabular-nums"
          />
        </Field>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700">
          {derived
            ? mode === "direct"
              ? "Which sub-company carries it?"
              : "Which sub-companies share it?"
            : mode === "percent"
              ? "Assign to sub-companies & percentage"
              : "Assign to sub-companies & quantity"}
        </p>
        <div className="space-y-1 rounded-lg border border-line p-2">
          {companies.map((c) => {
            const on = active.has(c.id);
            const share = derived ? (derivedShares[c.id] ?? 0) : Number(qty[c.id]) || 0;
            const amount = on
              ? fixedAllocationAmount({ splitMode: mode, unitAmount: unit }, share)
              : 0;
            return (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="companyId"
                    value={c.id}
                    checked={on}
                    onChange={() => toggle(c.id)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  {c.name}
                </label>
                <div className="flex items-center gap-3">
                  {derived ? (
                    <span className="text-sm tabular-nums text-slate-600">
                      {on ? `${Math.round(share * 10) / 10}%` : "—"}
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted">{mode === "percent" ? "%" : "Qty"}</span>
                      <Input
                        name={`qty_${c.id}`}
                        type="number"
                        step="0.01"
                        min="0"
                        max={mode === "percent" ? 100 : undefined}
                        value={qty[c.id] ?? ""}
                        disabled={!on}
                        onChange={(e) => setQty((s) => ({ ...s, [c.id]: e.target.value }))}
                        className="w-20 text-right"
                      />
                    </div>
                  )}
                  <span className="w-24 text-right text-sm tabular-nums text-slate-900">
                    {on ? formatCurrency(amount) : "—"}
                  </span>
                </div>
              </div>
            );
          })}

          {mode === "percent" && (
            <div
              className={cn(
                "flex justify-between border-t border-line px-2 pt-2 text-sm",
                percentBalanced ? "text-emerald-700" : "text-amber-700",
              )}
            >
              <span>Total</span>
              <span className="font-medium">{percentTotal.toFixed(2)}%</span>
            </div>
          )}

          <div className="flex justify-between border-t border-line px-2 pt-2 text-sm font-medium text-slate-900">
            <span>Bill total</span>
            <span className="tabular-nums">{formatCurrency(previewTotal)}</span>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted">
          {derived
            ? mode === "direct"
              ? "The whole amount goes on this one company's invoice."
              : "Percentages are shown on today's numbers and recalculated when the invoice run reads them — nothing is saved."
            : mode === "percent"
              ? "Tick each company that shares this cost and set its percentage. They must add up to 100%."
              : "Tick each company that shares this cost and set how many it takes."}
        </p>
        {derivedEmpty && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {mode === "per_sqm"
              ? "None of the ticked companies has floor space set, so this would bill nothing. Set it under Controls."
              : "None of the ticked companies has billable headcount, so this would bill nothing. Check the Headcount tab in Controls."}
          </p>
        )}
      </div>

      <Field label="Notes (optional)" hint="Shown on the page and in the email. Not on the invoice.">
        <Textarea name="notes" defaultValue={bill?.notes ?? ""} rows={2} />
      </Field>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <p className="text-xs text-muted">
          Saving keeps it as a draft. Submit it from the list when you&rsquo;re ready.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <SaveButton label={bill ? "Save changes" : "Save draft"} />
        </div>
      </div>
    </form>
  );
}
