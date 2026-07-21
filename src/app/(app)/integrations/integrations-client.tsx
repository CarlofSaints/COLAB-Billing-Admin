"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plug, CheckCircle2, ShieldCheck } from "lucide-react";
import { saveXero, saveDext, type IntegrationState } from "@/app/actions/integrations";
import {
  INTEGRATIONS,
  REQUIRED_KEYS,
  type IntegrationField,
} from "@/lib/integrations-fields";
import type { FieldStatus } from "@/lib/integrations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";

const ACTIONS = { xero: saveXero, dext: saveDext } as const;

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save credentials"}
    </Button>
  );
}

function FieldRow({ field, status }: { field: IntegrationField; status?: FieldStatus }) {
  const set = status?.set;
  return (
    <div>
      <Label htmlFor={field.key}>
        {field.label}
        {field.optional && <span className="ml-1 text-xs font-normal text-muted">(optional)</span>}
        {set && (
          <Badge tone="green" className="ml-2 align-middle">
            Saved {status?.hint ?? ""}
          </Badge>
        )}
      </Label>
      <Input
        id={field.key}
        name={field.key}
        type={field.secret ? "password" : "text"}
        autoComplete="off"
        placeholder={set ? "Leave blank to keep current value" : field.placeholder ?? ""}
      />
      {set && (
        <label className="mt-1.5 flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            name={`clear_${field.key}`}
            className="h-3.5 w-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500"
          />
          Remove this value
        </label>
      )}
    </div>
  );
}

function ProviderCard({
  id,
  name,
  blurb,
  fields,
  statuses,
}: {
  id: "xero" | "dext";
  name: string;
  blurb: string;
  fields: readonly IntegrationField[];
  statuses: Record<string, FieldStatus>;
}) {
  const [state, action] = useActionState<IntegrationState, FormData>(ACTIONS[id], {});
  const configured = REQUIRED_KEYS[id].every((k) => statuses[k]?.set);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-brand-600" /> {name}
          </CardTitle>
          <CardDescription>{blurb}</CardDescription>
        </div>
        {configured ? (
          <Badge tone="green">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
          </Badge>
        ) : (
          <Badge tone="neutral">Not configured</Badge>
        )}
      </CardHeader>
      <form action={action}>
        <CardContent className="space-y-4">
          {fields.map((f) => (
            <FieldRow key={f.key} field={f} status={statuses[f.key]} />
          ))}
          {state.ok && (
            <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Saved.
            </p>
          )}
          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}
        </CardContent>
        <div className="flex items-center justify-end border-t border-line px-5 py-3">
          <SaveButton />
        </div>
      </form>
    </Card>
  );
}

export function IntegrationsClient({ statuses }: { statuses: Record<string, FieldStatus> }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          Credentials are encrypted (AES-256-GCM) before storage and never shown again in full —
          only a masked hint. Saving these here lets COLAB pull bills from Dext and push invoices to
          Xero automatically (that wiring comes next).
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {INTEGRATIONS.map((p) => (
          <ProviderCard
            key={p.id}
            id={p.id}
            name={p.name}
            blurb={p.blurb}
            fields={p.fields}
            statuses={statuses}
          />
        ))}
      </div>
    </div>
  );
}
