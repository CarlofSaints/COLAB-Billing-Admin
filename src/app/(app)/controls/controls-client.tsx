"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Ruler, Users, Receipt, Plus, Trash2 } from "lucide-react";
import {
  saveSquareMetres,
  saveHeadcounts,
  addFixedItem,
  deleteFixedItem,
  type ActionState,
} from "@/app/actions/controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { formatCurrency, cn } from "@/lib/utils";

type FixedItem = { id: number; name: string; quantity: number; unitAmount: number; notes: string };
type ControlCompany = {
  id: number;
  name: string;
  sqm: number;
  headcountOverride: number | null;
  liveHeadcount: number;
  effectiveHeadcount: number;
  fixedItems: FixedItem[];
};

const TABS = [
  { key: "sqm", label: "Per Square Metre", icon: Ruler },
  { key: "headcount", label: "Headcount", icon: Users },
  { key: "fixed", label: "Fixed Line Items", icon: Receipt },
] as const;

function pct(part: number, total: number) {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function SaveBar({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-3">
      <Saved />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
    </div>
  );
}
function Saved() {
  return null;
}

/* -------------------- Square metres -------------------- */
function SqmTab({ companies, canManage }: { companies: ControlCompany[]; canManage: boolean }) {
  const [values, setValues] = useState<Record<number, string>>(
    Object.fromEntries(companies.map((c) => [c.id, String(c.sqm)])),
  );
  const [state, action] = useActionState<ActionState, FormData>(saveSquareMetres, {});
  const total = useMemo(
    () => companies.reduce((s, c) => s + (Number(values[c.id]) || 0), 0),
    [companies, values],
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Floor space</CardTitle>
          <CardDescription>
            Expenses like rent are split in proportion to the square metres each company occupies.
          </CardDescription>
        </div>
        <Badge tone="brand">{total.toLocaleString()} m² total</Badge>
      </CardHeader>
      <form action={action}>
        <Table>
          <THead>
            <tr>
              <TH>Sub-Company</TH>
              <TH className="w-48">Square metres</TH>
              <TH className="w-40">Share</TH>
            </tr>
          </THead>
          <tbody>
            {companies.map((c) => {
              const v = Number(values[c.id]) || 0;
              return (
                <TR key={c.id}>
                  <TD className="font-medium text-slate-900">{c.name}</TD>
                  <TD>
                    <Input
                      name={`sqm_${c.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      value={values[c.id] ?? ""}
                      disabled={!canManage}
                      onChange={(e) => setValues((s) => ({ ...s, [c.id]: e.target.value }))}
                    />
                  </TD>
                  <TD>
                    <ShareBar value={pct(v, total)} />
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        {state.ok && <SavedNote />}
        {canManage && <SaveBar label="Save floor space" />}
      </form>
    </Card>
  );
}

/* -------------------- Headcount -------------------- */
function HeadcountTab({ companies, canManage }: { companies: ControlCompany[]; canManage: boolean }) {
  const [overrides, setOverrides] = useState<Record<number, string>>(
    Object.fromEntries(companies.map((c) => [c.id, c.headcountOverride?.toString() ?? ""])),
  );
  const [state, action] = useActionState<ActionState, FormData>(saveHeadcounts, {});

  const effective = (c: ControlCompany) => {
    const o = overrides[c.id];
    return o === "" || o == null ? c.liveHeadcount : Number(o) || 0;
  };
  const total = useMemo(
    () => companies.reduce((s, c) => s + effective(c), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companies, overrides],
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Headcount</CardTitle>
          <CardDescription>
            Utilities and consumables are split per person. Leave the override blank to use the live
            staff count.
          </CardDescription>
        </div>
        <Badge tone="brand">{total} people total</Badge>
      </CardHeader>
      <form action={action}>
        <Table>
          <THead>
            <tr>
              <TH>Sub-Company</TH>
              <TH className="w-32">Live count</TH>
              <TH className="w-40">Override</TH>
              <TH className="w-24">Effective</TH>
              <TH className="w-40">Share</TH>
            </tr>
          </THead>
          <tbody>
            {companies.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium text-slate-900">{c.name}</TD>
                <TD>
                  <Badge tone="neutral">{c.liveHeadcount}</Badge>
                </TD>
                <TD>
                  <Input
                    name={`hc_${c.id}`}
                    type="number"
                    min="0"
                    step="1"
                    placeholder="auto"
                    value={overrides[c.id] ?? ""}
                    disabled={!canManage}
                    onChange={(e) => setOverrides((s) => ({ ...s, [c.id]: e.target.value }))}
                  />
                </TD>
                <TD className="font-medium">{effective(c)}</TD>
                <TD>
                  <ShareBar value={pct(effective(c), total)} />
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
        {state.ok && <SavedNote />}
        {canManage && <SaveBar label="Save headcount" />}
      </form>
    </Card>
  );
}

/* -------------------- Fixed line items -------------------- */
function FixedTab({ companies, canManage }: { companies: ControlCompany[]; canManage: boolean }) {
  const [adding, setAdding] = useState(false);
  const grandTotal = companies.reduce(
    (s, c) => s + c.fixedItems.reduce((t, i) => t + i.quantity * i.unitAmount, 0),
    0,
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Fixed line items</CardTitle>
          <CardDescription>
            Costs billed directly to one company — e.g. the parking bays each company takes.
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone="brand">{formatCurrency(grandTotal)} / month</Badge>
          {canManage && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add item
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {companies.every((c) => c.fixedItems.length === 0) ? (
          <p className="py-6 text-center text-sm text-muted">
            No fixed line items yet. Add one to bill a company for something like parking.
          </p>
        ) : (
          companies
            .filter((c) => c.fixedItems.length > 0)
            .map((c) => {
              const subtotal = c.fixedItems.reduce((t, i) => t + i.quantity * i.unitAmount, 0);
              return (
                <div key={c.id}>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">{c.name}</h4>
                    <span className="text-sm font-medium text-slate-600">
                      {formatCurrency(subtotal)}
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-line">
                    <Table>
                      <THead>
                        <tr>
                          <TH>Description</TH>
                          <TH className="w-24 text-right">Qty</TH>
                          <TH className="w-32 text-right">Unit</TH>
                          <TH className="w-32 text-right">Total</TH>
                          {canManage && <TH className="w-16"></TH>}
                        </tr>
                      </THead>
                      <tbody>
                        {c.fixedItems.map((i) => (
                          <TR key={i.id}>
                            <TD>
                              <div className="font-medium text-slate-800">{i.name}</div>
                              {i.notes && <div className="text-xs text-muted">{i.notes}</div>}
                            </TD>
                            <TD className="text-right">{i.quantity}</TD>
                            <TD className="text-right">{formatCurrency(i.unitAmount)}</TD>
                            <TD className="text-right font-medium">
                              {formatCurrency(i.quantity * i.unitAmount)}
                            </TD>
                            {canManage && (
                              <TD className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm(`Remove “${i.name}”?`)) deleteFixedItem(i.id);
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                </Button>
                              </TD>
                            )}
                          </TR>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </div>
              );
            })
        )}
      </CardContent>

      {adding && (
        <Modal title="Add fixed line item" open onOpenChange={setAdding}>
          <FixedItemForm companies={companies} onDone={() => setAdding(false)} />
        </Modal>
      )}
    </Card>
  );
}

function FixedItemForm({
  companies,
  onDone,
}: {
  companies: ControlCompany[];
  onDone: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(addFixedItem, {});
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="space-y-4">
      <Field label="Company">
        <Select name="companyId" required defaultValue="">
          <option value="" disabled>
            Select a sub-company…
          </option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Description">
        <Input name="name" placeholder="e.g. Parking bays" required />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Quantity">
          <Input name="quantity" type="number" step="0.01" min="0" defaultValue="1" />
        </Field>
        <Field label="Unit amount (excl. VAT)">
          <Input name="unitAmount" type="number" step="0.01" min="0" defaultValue="0" />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Input name="notes" />
      </Field>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Add item</Button>
      </div>
    </form>
  );
}

/* -------------------- shared bits -------------------- */
function ShareBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="w-12 text-right text-xs tabular-nums text-muted">{value.toFixed(1)}%</span>
    </div>
  );
}

function SavedNote() {
  return (
    <p className="px-5 pt-3 text-sm text-emerald-700">Saved.</p>
  );
}

export function ControlsManager({
  companies,
  canManage,
}: {
  companies: ControlCompany[];
  canManage: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("sqm");

  if (companies.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted">
            No sub-companies exist yet. Add them on the Sub-Companies page and they&apos;ll appear
            here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-line bg-white p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                tab === t.key
                  ? "bg-brand-700 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "sqm" && <SqmTab companies={companies} canManage={canManage} />}
      {tab === "headcount" && <HeadcountTab companies={companies} canManage={canManage} />}
      {tab === "fixed" && <FixedTab companies={companies} canManage={canManage} />}
    </div>
  );
}
