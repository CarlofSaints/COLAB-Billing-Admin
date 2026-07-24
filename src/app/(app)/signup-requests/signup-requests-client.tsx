"use client";

import { useState } from "react";
import {
  UserCheck,
  Inbox,
  CheckCircle2,
  XCircle,
  TriangleAlert,
  Mail,
} from "lucide-react";
import { approveSignup, declineSignup, type InviteState } from "@/app/actions/team";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/page";
import { formatDateTime } from "@/lib/utils";

type PendingRow = {
  id: number;
  name: string;
  email: string;
  companyName: string | null;
  createdAt: string;
};

type DecidedRow = PendingRow & {
  status: "approved" | "declined" | "pending";
  decidedByName: string | null;
  decidedAt: string | null;
};

function PendingCard({ req }: { req: PendingRow }) {
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [result, setResult] = useState<InviteState | null>(null);

  async function onApprove() {
    setBusy("approve");
    const r = await approveSignup(req.id);
    setResult(r);
    setBusy(null);
  }
  async function onDecline() {
    if (!confirm(`Decline the request from ${req.name}?`)) return;
    setBusy("decline");
    const r = await declineSignup(req.id);
    if (r.error) setResult({ error: r.error });
    setBusy(null);
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{req.name}</p>
          <p className="text-sm text-muted">{req.email}</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone="brand">{req.companyName ?? "Unknown company"}</Badge>
            <span className="text-xs text-muted">Requested {formatDateTime(req.createdAt)}</span>
          </div>
        </div>
        {!result?.ok && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onDecline} disabled={busy !== null}>
              <XCircle className="h-4 w-4" /> Decline
            </Button>
            <Button size="sm" onClick={onApprove} disabled={busy !== null}>
              <CheckCircle2 className="h-4 w-4" />
              {busy === "approve" ? "Approving…" : "Approve"}
            </Button>
          </div>
        )}
      </div>

      {result?.error && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="h-4 w-4" /> {result.error}
        </p>
      )}
      {result?.ok && (
        <div className="mt-3 space-y-2">
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {result.emailed
              ? `Approved — welcome email sent to ${result.emailTo}.`
              : "Approved and login created."}
          </p>
          {!result.emailed && result.tempPassword && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <p className="flex items-center gap-1.5 text-slate-600">
                <Mail className="h-3.5 w-3.5" /> {result.emailError} Share this temporary password:
              </p>
              <code className="mt-1 block font-mono text-base font-semibold text-slate-900">
                {result.tempPassword}
              </code>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function SignupRequestsClient({
  pending,
  decided,
}: {
  pending: PendingRow[];
  decided: DecidedRow[];
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Inbox className="h-4 w-4" /> Pending ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <EmptyState
            icon={<UserCheck className="h-8 w-8" />}
            title="Nothing waiting"
            description="New requests from the public join form show up here for approval."
          />
        ) : (
          <div className="space-y-3">
            {pending.map((req) => (
              <PendingCard key={req.id} req={req} />
            ))}
          </div>
        )}
      </section>

      {decided.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Recently decided</h2>
          <Card className="divide-y divide-line">
            {decided.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{r.name}</p>
                  <p className="truncate text-xs text-muted">
                    {r.email} · {r.companyName ?? "—"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {r.decidedByName && (
                    <span className="hidden text-xs text-muted sm:inline">
                      by {r.decidedByName}
                      {r.decidedAt ? ` · ${formatDateTime(r.decidedAt)}` : ""}
                    </span>
                  )}
                  <Badge tone={r.status === "approved" ? "green" : "neutral"}>{r.status}</Badge>
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
