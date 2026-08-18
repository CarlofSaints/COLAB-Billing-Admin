"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { CheckCircle2, Mail, Send, TriangleAlert, UserX, Tag as TagIcon } from "lucide-react";
import {
  sendAllNudges,
  sendOneNudge,
  sendSamplesToMe,
  setNudgeAuto,
  type NudgeActionState,
} from "@/app/actions/profile-nudges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TH, SortableTH, TR, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/page";
import { useTableSort } from "@/lib/use-table-sort";
import { formatDateTime } from "@/lib/utils";

type Target = {
  userId: number;
  staffId: number | null;
  name: string;
  email: string;
  companyName: string | null;
  missing: string[];
  tagCount: number;
  lastNudgeAt: string | null;
  dueForNudge: boolean;
};

type Untagged = { staffId: number; name: string; companyName: string | null };

function Pending({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

/** One row's "send just this one" form — a test send that skips the cooldown. */
function TestSend({ userId }: { userId: number }) {
  const [state, action] = useActionState<NudgeActionState, FormData>(sendOneNudge, {});
  return (
    <form action={action} className="flex items-center justify-end gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Pending label="Send" busy="Sending…" />
      {state.ok && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
      {state.error && (
        <span className="text-xs text-red-600" title={state.error}>
          Failed
        </span>
      )}
    </form>
  );
}

function PeopleTable({
  rows,
  showMissing,
  cooldownDays,
}: {
  rows: Target[];
  showMissing: boolean;
  cooldownDays: number;
}) {
  const { sorted, sort, toggle } = useTableSort(
    rows,
    {
      name: (r) => r.name,
      email: (r) => r.email,
      company: (r) => r.companyName,
      missing: (r) => r.missing.length,
      lastNudge: (r) => r.lastNudgeAt,
    },
    { key: "name", dir: "asc" },
  );

  return (
    <Table>
      <THead>
        <tr>
          <SortableTH sortKey="name" sort={sort} onSort={toggle}>
            Person
          </SortableTH>
          <SortableTH sortKey="company" sort={sort} onSort={toggle}>
            Company
          </SortableTH>
          {showMissing && (
            <SortableTH sortKey="missing" sort={sort} onSort={toggle}>
              Still missing
            </SortableTH>
          )}
          <SortableTH sortKey="lastNudge" sort={sort} onSort={toggle}>
            Last reminded
          </SortableTH>
          <TH className="w-28 text-right">Test send</TH>
        </tr>
      </THead>
      <tbody>
        {sorted.map((r) => (
          <TR key={r.userId}>
            <TD>
              <div className="font-medium text-slate-900">{r.name}</div>
              <div className="text-xs text-muted">{r.email}</div>
            </TD>
            <TD className="text-sm">{r.companyName ?? "—"}</TD>
            {showMissing && (
              <TD>
                <div className="flex flex-wrap gap-1">
                  {r.missing.map((m) => (
                    <Badge key={m} tone="amber">
                      {m}
                    </Badge>
                  ))}
                </div>
              </TD>
            )}
            <TD className="text-xs text-muted">
              {r.lastNudgeAt ? (
                <>
                  {formatDateTime(r.lastNudgeAt)}
                  {!r.dueForNudge && (
                    <span className="block text-slate-400">
                      quiet for {cooldownDays} days
                    </span>
                  )}
                </>
              ) : (
                "Never"
              )}
            </TD>
            <TD className="text-right">
              <TestSend userId={r.userId} />
            </TD>
          </TR>
        ))}
      </tbody>
    </Table>
  );
}

export function ProfileNudgesClient({
  neverSignedIn,
  incompleteProfile,
  untagged,
  autoOn,
  cooldownDays,
  mailConfigured,
}: {
  neverSignedIn: Target[];
  incompleteProfile: Target[];
  untagged: Untagged[];
  autoOn: boolean;
  cooldownDays: number;
  mailConfigured: boolean;
}) {
  const [autoState, autoAction] = useActionState<NudgeActionState, FormData>(setNudgeAuto, {});
  const [bulkState, bulkAction] = useActionState<NudgeActionState, FormData>(sendAllNudges, {});
  const [sampleState, sampleAction] = useActionState<NudgeActionState, FormData>(
    sendSamplesToMe,
    {},
  );
  const [confirmBulk, setConfirmBulk] = useState(false);

  const total = neverSignedIn.length + incompleteProfile.length;

  return (
    <div className="space-y-4">
      {!mailConfigured && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            No mail provider is configured, so nothing can be sent from this page. Set one up under{" "}
            <Link href="/integrations" className="font-medium underline">
              Integrations
            </Link>
            .
          </div>
        </div>
      )}

      {/* Automatic run + send-to-everyone. Both write to real inboxes, so both
          are deliberate acts rather than something that happens on page load. */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Reminders</CardTitle>
            <CardDescription>
              The weekly run goes out on Monday mornings and leaves each person alone for{" "}
              {cooldownDays} days after reminding them, so nobody gets the same nudge over and
              over. Send a test to yourself first — these go to real people.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={autoAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="enabled" value={autoOn ? "off" : "on"} />
            <Badge tone={autoOn ? "green" : "neutral"}>
              Weekly nudges are {autoOn ? "ON" : "OFF"}
            </Badge>
            <Pending
              label={autoOn ? "Switch off" : "Switch on"}
              busy="Saving…"
            />
            {autoState.ok && <span className="text-sm text-emerald-700">{autoState.ok}</span>}
            {autoState.error && <span className="text-sm text-red-600">{autoState.error}</span>}
          </form>

          <form action={sampleAction} className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <Pending label="Email both samples to me" busy="Sending…" />
            <span className="text-xs text-muted">
              Goes to your own address only, with every field marked missing, so you can see
              exactly what lands.
            </span>
            {sampleState.ok && <span className="text-sm text-emerald-700">{sampleState.ok}</span>}
            {sampleState.error && (
              <span className="text-sm text-red-600">{sampleState.error}</span>
            )}
          </form>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
            {confirmBulk ? (
              <form action={bulkAction} className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-slate-700">
                  Email all {total} {total === 1 ? "person" : "people"} listed below, right now?
                </span>
                <Pending label="Yes, send them all" busy="Sending…" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmBulk(false)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={total === 0 || !mailConfigured}
                onClick={() => setConfirmBulk(true)}
              >
                <Send className="h-4 w-4" /> Send to everyone now
              </Button>
            )}
            {bulkState.ok && <span className="text-sm text-emerald-700">{bulkState.ok}</span>}
            {bulkState.error && <span className="text-sm text-red-600">{bulkState.error}</span>}
          </div>
        </CardContent>
      </Card>

      {/* 1. Never signed in */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Never signed in</CardTitle>
            <CardDescription>
              Active accounts that have never been used. Their email asks them to sign in and
              fill in their profile. It does <strong>not</strong> contain a password — passwords
              are stored scrambled and cannot be read back, so it points at the reset link
              instead. Whatever password they were given still works.
            </CardDescription>
          </div>
          <Badge tone={neverSignedIn.length ? "amber" : "green"}>{neverSignedIn.length}</Badge>
        </CardHeader>
        {neverSignedIn.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={<CheckCircle2 className="h-8 w-8" />}
              title="Everyone has signed in at least once"
            />
          </CardContent>
        ) : (
          <PeopleTable rows={neverSignedIn} showMissing={false} cooldownDays={cooldownDays} />
        )}
      </Card>

      {/* 2. Signed in, profile incomplete */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Profile not finished</CardTitle>
            <CardDescription>
              They&apos;ve signed in, but their directory entry is missing things only they can
              fill in. Their email lists exactly what&apos;s blank.
            </CardDescription>
          </div>
          <Badge tone={incompleteProfile.length ? "amber" : "green"}>
            {incompleteProfile.length}
          </Badge>
        </CardHeader>
        {incompleteProfile.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={<CheckCircle2 className="h-8 w-8" />}
              title="Every profile is complete"
            />
          </CardContent>
        ) : (
          <PeopleTable rows={incompleteProfile} showMissing cooldownDays={cooldownDays} />
        )}
      </Card>

      {/* 3. Tags — an office job, not an email */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>No tags applied</CardTitle>
            <CardDescription>
              Nobody is emailed about this. Tags are applied by the office, not by the person —
              they aren&apos;t on My Profile at all, and some of them (Parking, VOIP) bill per
              head. This is a list for whoever keeps them straight.
            </CardDescription>
          </div>
          <Badge tone={untagged.length ? "neutral" : "green"}>{untagged.length}</Badge>
        </CardHeader>
        <CardContent>
          {untagged.length === 0 ? (
            <EmptyState
              icon={<TagIcon className="h-8 w-8" />}
              title="Everyone on the team list carries at least one tag"
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {untagged.map((u) => (
                  <span
                    key={u.staffId}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-sm text-slate-700"
                  >
                    <UserX className="h-3.5 w-3.5 text-slate-400" />
                    {u.name}
                    {u.companyName && (
                      <span className="text-xs text-muted">· {u.companyName}</span>
                    )}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-sm">
                <Link href="/staff" className="font-medium text-brand-700 hover:underline">
                  Open Team Members
                </Link>{" "}
                <span className="text-muted">to apply them.</span>
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 px-1 text-xs text-muted">
        <Mail className="h-3.5 w-3.5" />
        Every send is written to the Activity Log.
      </p>
    </div>
  );
}
