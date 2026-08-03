"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Pencil, Car, TriangleAlert, Archive, RotateCcw, Search } from "lucide-react";
import { saveVehicle, setVehicleActive, type VehicleState } from "@/app/actions/vehicles";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { brandFor } from "@/lib/brands";
import { cn } from "@/lib/utils";

type VehicleRow = {
  id: number;
  name: string;
  nickname: string | null;
  vin: string | null;
  regNumber: string;
  colour: string | null;
  branded: boolean;
  companyId: number;
  companyName: string;
  active: boolean;
};

type SubCompany = { id: number; name: string };

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function VehicleForm({
  vehicle,
  subCompanies,
  onDone,
}: {
  vehicle?: VehicleRow;
  subCompanies: SubCompany[];
  onDone: () => void;
}) {
  const editing = !!vehicle;
  const [state, action] = useActionState<VehicleState, FormData>(saveVehicle, {});
  const [branded, setBranded] = useState(vehicle?.branded ?? false);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="space-y-4">
      {editing && <input type="hidden" name="id" value={vehicle.id} />}

      <Field label="Vehicle" hint="Make and model, e.g. Toyota Corolla 1.6.">
        <Input name="name" defaultValue={vehicle?.name ?? ""} required autoFocus maxLength={80} />
      </Field>

      <Field label="Nickname" hint="Optional — what people actually call it, e.g. Little Baby.">
        <Input name="nickname" defaultValue={vehicle?.nickname ?? ""} maxLength={40} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Registration number">
          <Input
            name="regNumber"
            defaultValue={vehicle?.regNumber ?? ""}
            required
            maxLength={20}
            placeholder="CA 123-456"
            // Stored uppercase either way; showing it uppercase as it's typed
            // means the field looks like what will be saved.
            className="uppercase"
          />
        </Field>
        <Field label="VIN" hint="Optional.">
          <Input
            name="vin"
            defaultValue={vehicle?.vin ?? ""}
            maxLength={32}
            className="uppercase"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Colour">
          <Input name="colour" defaultValue={vehicle?.colour ?? ""} maxLength={30} />
        </Field>
        <Field label="Belongs to">
          <Select name="companyId" defaultValue={vehicle?.companyId ?? ""} required>
            <option value="" disabled>
              Pick a sub-company…
            </option>
            {subCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Branded" hint="Is it carrying the company's livery?">
        <input type="hidden" name="branded" value={branded ? "yes" : "no"} />
        <div className="flex gap-2">
          {[
            { on: true, label: "Yes" },
            { on: false, label: "No" },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setBranded(opt.on)}
              className={cn(
                "rounded-full border px-4 py-1 text-sm font-medium transition-colors",
                branded === opt.on
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-line text-slate-500 hover:bg-slate-50",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      {state.error && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SaveButton label={editing ? "Save changes" : "Add vehicle"} />
      </div>
    </form>
  );
}

export function VehiclesClient({
  vehicles,
  subCompanies,
}: {
  vehicles: VehicleRow[];
  subCompanies: SubCompany[];
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<VehicleRow | null>(null);
  const [search, setSearch] = useState("");
  const [pending, start] = useTransition();

  const term = search.trim().toLowerCase();
  const shown = term
    ? vehicles.filter((v) =>
        [v.name, v.nickname, v.regNumber, v.colour, v.companyName]
          .filter(Boolean)
          .some((f) => f!.toLowerCase().includes(term)),
      )
    : vehicles;

  // Adding a vehicle needs somewhere to put it. Without this the form's only
  // required dropdown would be empty and the save would fail with a message
  // about picking a sub-company that can't be acted on.
  if (subCompanies.length === 0) {
    return (
      <EmptyState
        icon={<Car className="h-8 w-8" />}
        title="No sub-companies yet"
        description="Every vehicle belongs to one of the sub-companies, so add those first on the Sub-Companies page."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {vehicles.length > 0 && (
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the fleet…"
              className="pl-9"
            />
          </div>
        )}
        <Button className="ml-auto" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add vehicle
        </Button>
      </div>

      {vehicles.length === 0 ? (
        <EmptyState
          icon={<Car className="h-8 w-8" />}
          title="No vehicles yet"
          description="Add the cars the office shares. Once they're here they can be booked."
          action={<Button onClick={() => setAdding(true)}>Add vehicle</Button>}
        />
      ) : shown.length === 0 ? (
        <Card className="px-4 py-8 text-center text-sm text-muted">
          Nothing matches “{search}”.
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {shown.map((v) => {
            const brand = brandFor(v.companyName);
            return (
              <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  {/* Owned-by colour, the same brand palette the calendar and
                      the wordmark use, so the fleet reads by company. */}
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
                    style={{
                      backgroundColor: `${brand.color}1f`,
                      borderColor: `${brand.color}66`,
                    }}
                  >
                    <Car className="h-4 w-4" style={{ color: brand.color }} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{v.name}</span>
                      {v.nickname && (
                        <span className="text-sm text-muted">“{v.nickname}”</span>
                      )}
                      {/* Neutral, not slate — slate is the dark "Retired"
                          pill, and two identical badges on one row would make
                          a live vehicle read as a retired one at a glance. */}
                      <Badge tone="neutral">{v.regNumber}</Badge>
                      {v.branded && <Badge tone="brand">Branded</Badge>}
                      {!v.active && <Badge tone="slate">Retired</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted">
                      {[v.companyName, v.colour, v.vin ? `VIN ${v.vin}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" title="Edit" onClick={() => setEditing(v)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    title={v.active ? "Retire this vehicle" : "Bring this vehicle back"}
                    onClick={() => {
                      const msg = v.active
                        ? `Retire "${v.name}" (${v.regNumber})? It stops appearing for new bookings, and its history is kept.`
                        : `Bring "${v.name}" back into the fleet?`;
                      if (confirm(msg)) start(() => setVehicleActive(v.id, !v.active));
                    }}
                  >
                    {v.active ? (
                      <Archive className="h-3.5 w-3.5 text-slate-500" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5 text-brand-600" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {adding && (
        <Modal title="Add vehicle" open onOpenChange={setAdding}>
          <VehicleForm subCompanies={subCompanies} onDone={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.name}`} open onOpenChange={(o) => !o && setEditing(null)}>
          <VehicleForm
            vehicle={editing}
            subCompanies={subCompanies}
            onDone={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}
