"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Ruler, Users, Receipt, Plus, Trash2, Pencil, DoorOpen } from "lucide-react";
import {
  saveSquareMetres,
  saveHeadcounts,
  addFixedItem,
  deleteFixedItem,
  saveCommonSpace,
  deleteCommonSpace,
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
type CommonSpaceRow = {
  id: number;
  name: string;
  sqm: number;
  splitMethod: "occupancy" | "custom";
  splits: { companyId: number; percent: number }[];
};

/**
 * Work out how much floor area each company effectively pays for:
 * their own occupied area, plus their share of every common space,
 * plus their pro-rata share of any common area not itemised into a line.
 */
function computeEffectiveAreas(
  companies: { id: number; name: string }[],
  occupied: Record<number, number>,
  commonSpaces: CommonSpaceRow[],
  totalSqm: number,
) {
  const occ = (id: number) => Math.max(0, occupied[id] || 0);
  const totalOccupied = companies.reduce((s, c) => s + occ(c.id), 0);
  const occFraction = (id: number) => (totalOccupied > 0 ? occ(id) / totalOccupied : 0);

  const common = Math.max(0, totalSqm - totalOccupied);
  const itemised = commonSpaces.reduce((s, cs) => s + Math.max(0, cs.sqm), 0);
  const unallocatedCommon = Math.max(0, common - itemised);

  const effective: Record<number, number> = {};
  for (const c of companies) {
    let area = occ(c.id);
    // Share of each itemised common space.
    for (const cs of commonSpaces) {
      if (cs.splitMethod === "custom") {
        const pct = cs.splits.find((s) => s.companyId === c.id)?.percent ?? 0;
        area += (pct / 100) * cs.sqm;
      } else {
        area += occFraction(c.id) * cs.sqm;
      }
    }
    // Share of leftover, un-itemised common space (pro-rata by occupancy).
    area += occFraction(c.id) * unallocatedCommon;
    effective[c.id] = area;
  }

  return { effective, totalOccupied, common, itemised, unallocatedCommon };
}

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
function SqmTab({
  companies,
  canManage,
  totalSqm,
  commonSpaces,
}: {
  companies: ControlCompany[];
  canManage: boolean;
  totalSqm: number;
  commonSpaces: CommonSpaceRow[];
}) {
  const [total, setTotal] = useState<string>(totalSqm ? String(totalSqm) : "");
  const [occupied, setOccupied] = useState<Record<number, string>>(
    Object.fromEntries(companies.map((c) => [c.id, c.sqm ? String(c.sqm) : ""])),
  );
  const [state, action] = useActionState<ActionState, FormData>(saveSquareMetres, {});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CommonSpaceRow | null>(null);

  const occupiedNum = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.id, Number(occupied[c.id]) || 0])),
    [companies, occupied],
  );
  const totalNum = Number(total) || 0;

  const { effective, totalOccupied, common, itemised, unallocatedCommon } = useMemo(
    () => computeEffectiveAreas(companies, occupiedNum, commonSpaces, totalNum),
    [companies, occupiedNum, commonSpaces, totalNum],
  );

  const overItemised = itemised > common + 0.01;

  return (
    <div className="space-y-4">
      {/* Building total + occupied space */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Floor space</CardTitle>
            <CardDescription>
              Enter the total building area and each company&apos;s occupied space. Anything not
              occupied becomes common space.
            </CardDescription>
          </div>
        </CardHeader>
        <form action={action}>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Total building area (m²)" className="w-56">
                <Input
                  name="total_sqm"
                  type="number"
                  step="0.01"
                  min="0"
                  value={total}
                  disabled={!canManage}
                  onChange={(e) => setTotal(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2 pb-2">
                <Stat label="Occupied" value={`${totalOccupied.toLocaleString()} m²`} />
                <Stat label="Common" value={`${common.toLocaleString()} m²`} tone="brand" />
                <Stat label="Itemised" value={`${itemised.toLocaleString()} m²`} />
                <Stat label="Unallocated" value={`${unallocatedCommon.toLocaleString()} m²`} />
              </div>
            </div>
            {overItemised && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Itemised common space ({itemised.toLocaleString()} m²) exceeds available common
                space ({common.toLocaleString()} m²). Increase the total area or reduce the rooms.
              </p>
            )}
          </CardContent>

          <Table>
            <THead>
              <tr>
                <TH>Sub-Company</TH>
                <TH className="w-48">Occupied m²</TH>
                <TH className="w-40">Of building</TH>
              </tr>
            </THead>
            <tbody>
              {companies.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium text-slate-900">{c.name}</TD>
                  <TD>
                    <Input
                      name={`sqm_${c.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      value={occupied[c.id] ?? ""}
                      disabled={!canManage}
                      onChange={(e) => setOccupied((s) => ({ ...s, [c.id]: e.target.value }))}
                    />
                  </TD>
                  <TD>
                    <ShareBar value={pct(occupiedNum[c.id], totalNum)} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          {state.error && <p className="px-5 pt-3 text-sm text-red-700">{state.error}</p>}
          {state.ok && <SavedNote />}
          {canManage && <SaveBar label="Save floor space" />}
        </form>
      </Card>

      {/* Common spaces */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Common spaces</CardTitle>
            <CardDescription>
              Break common space into rooms and choose how each is split — pro-rata by occupancy, or
              by percentages you set.
            </CardDescription>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add common space
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {commonSpaces.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              No itemised common spaces yet. Any common area is currently split pro-rata by
              occupancy. Add a boardroom or training room to split it differently.
            </p>
          ) : (
            <div className="space-y-2">
              {commonSpaces.map((cs) => (
                <div
                  key={cs.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-line px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <DoorOpen className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">
                        {cs.name}{" "}
                        <span className="text-sm font-normal text-muted">
                          · {cs.sqm.toLocaleString()} m²
                        </span>
                      </div>
                      {cs.splitMethod === "custom" ? (
                        <div className="mt-0.5 text-xs text-muted">
                          Custom:{" "}
                          {cs.splits
                            .map((sp) => {
                              const co = companies.find((c) => c.id === sp.companyId);
                              return co ? `${co.name} ${sp.percent}%` : null;
                            })
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-xs text-muted">Split pro-rata by occupancy</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge tone={cs.splitMethod === "custom" ? "amber" : "neutral"}>
                      {cs.splitMethod === "custom" ? "Custom %" : "Occupancy"}
                    </Badge>
                    {canManage && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(cs)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Remove “${cs.name}”?`)) deleteCommonSpace(cs.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Effective share */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Effective floor-space share</CardTitle>
            <CardDescription>
              Occupied space plus each company&apos;s share of common areas. Rent and other per-m²
              costs are billed on these figures.
            </CardDescription>
          </div>
        </CardHeader>
        <Table>
          <THead>
            <tr>
              <TH>Sub-Company</TH>
              <TH className="w-32 text-right">Private m²</TH>
              <TH className="w-32 text-right">+ Common m²</TH>
              <TH className="w-32 text-right">Effective m²</TH>
              <TH className="w-40">Billed share</TH>
            </tr>
          </THead>
          <tbody>
            {companies.map((c) => {
              const eff = effective[c.id] ?? 0;
              const priv = occupiedNum[c.id];
              return (
                <TR key={c.id}>
                  <TD className="font-medium text-slate-900">{c.name}</TD>
                  <TD className="text-right">{priv.toLocaleString()}</TD>
                  <TD className="text-right text-muted">
                    +{Math.max(0, eff - priv).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </TD>
                  <TD className="text-right font-medium">
                    {eff.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </TD>
                  <TD>
                    <ShareBar value={pct(eff, totalNum)} />
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {adding && (
        <Modal title="Add common space" open onOpenChange={setAdding}>
          <CommonSpaceForm companies={companies} onDone={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal
          title={`Edit ${editing.name}`}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        >
          <CommonSpaceForm
            companies={companies}
            space={editing}
            onDone={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function CommonSpaceForm({
  companies,
  space,
  onDone,
}: {
  companies: ControlCompany[];
  space?: CommonSpaceRow;
  onDone: () => void;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveCommonSpace, {});
  const [method, setMethod] = useState<"occupancy" | "custom">(space?.splitMethod ?? "occupancy");
  const [pcts, setPcts] = useState<Record<number, string>>(
    Object.fromEntries(
      companies.map((c) => [
        c.id,
        space?.splits.find((s) => s.companyId === c.id)?.percent?.toString() ?? "",
      ]),
    ),
  );
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const sum = companies.reduce((s, c) => s + (Number(pcts[c.id]) || 0), 0);

  return (
    <form action={action} className="space-y-4">
      {space && <input type="hidden" name="id" value={space.id} />}
      <input type="hidden" name="splitMethod" value={method} />
      <Field label="Name">
        <Input name="name" defaultValue={space?.name} placeholder="e.g. Boardroom" required autoFocus />
      </Field>
      <Field label="Size (m²)">
        <Input name="squareMetres" type="number" step="0.01" min="0" defaultValue={space?.sqm ?? ""} required />
      </Field>

      <div>
        <p className="mb-1.5 block text-sm font-medium text-slate-700">How is it split?</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMethod("occupancy")}
            className={cn(
              "rounded-lg border px-3 py-2 text-left text-sm",
              method === "occupancy"
                ? "border-brand-600 bg-brand-50 text-brand-800"
                : "border-line text-slate-600 hover:bg-slate-50",
            )}
          >
            <span className="font-medium">By occupancy</span>
            <span className="block text-xs text-muted">Pro-rata to occupied space</span>
          </button>
          <button
            type="button"
            onClick={() => setMethod("custom")}
            className={cn(
              "rounded-lg border px-3 py-2 text-left text-sm",
              method === "custom"
                ? "border-brand-600 bg-brand-50 text-brand-800"
                : "border-line text-slate-600 hover:bg-slate-50",
            )}
          >
            <span className="font-medium">Custom %</span>
            <span className="block text-xs text-muted">Set a share per company</span>
          </button>
        </div>
      </div>

      {method === "custom" && (
        <div className="space-y-2 rounded-lg border border-line p-3">
          {companies.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-700">{c.name}</span>
              <div className="flex items-center gap-1">
                <Input
                  name={`pct_${c.id}`}
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
              "flex justify-between border-t border-line pt-2 text-sm",
              Math.abs(sum - 100) < 0.01 ? "text-emerald-700" : "text-amber-700",
            )}
          >
            <span>Total</span>
            <span className="font-medium">{sum.toFixed(1)}%</span>
          </div>
        </div>
      )}

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">{space ? "Save" : "Add space"}</Button>
      </div>
    </form>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "brand" }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-1.5",
        tone === "brand" ? "border-brand-200 bg-brand-50" : "border-line bg-slate-50",
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("text-sm font-semibold", tone === "brand" ? "text-brand-800" : "text-slate-900")}>
        {value}
      </div>
    </div>
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
  totalSqm,
  commonSpaces,
}: {
  companies: ControlCompany[];
  canManage: boolean;
  totalSqm: number;
  commonSpaces: CommonSpaceRow[];
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

      {tab === "sqm" && (
        <SqmTab
          companies={companies}
          canManage={canManage}
          totalSqm={totalSqm}
          commonSpaces={commonSpaces}
        />
      )}
      {tab === "headcount" && <HeadcountTab companies={companies} canManage={canManage} />}
      {tab === "fixed" && <FixedTab companies={companies} canManage={canManage} />}
    </div>
  );
}
