"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Search, X } from "lucide-react";
import {
  reportIssuePublic,
  searchTeamMembers,
  type PublicReportState,
} from "@/app/actions/public-issues";
import { Button } from "@/components/ui/button";
import { Input, Field, Select, Textarea } from "@/components/ui/field";
import { ISSUE_CATEGORIES } from "@/lib/issues";

type Match = { id: number; name: string; companyName: string };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Sending…" : "Report it"}
    </Button>
  );
}

/**
 * The name picker on the public form.
 *
 * A search box rather than a dropdown of everyone: the page is open to anyone
 * with the sticker, and a full <select> would publish the staff list to them.
 * Names are fetched only once two characters are typed.
 */
function WhoAreYou({
  picked,
  onPick,
}: {
  picked: Match | null;
  onPick: (m: Match | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    // Debounced, and stale responses are discarded — typing quickly must not
    // leave an earlier, slower result on screen.
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await searchTeamMembers(q);
      if (seq.current === mine) {
        setMatches(res);
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  if (picked) {
    return (
      <Field label="You are">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2">
          <span className="text-sm text-slate-800">
            {picked.name}
            <span className="ml-2 text-xs text-muted">{picked.companyName}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              onPick(null);
              setQuery("");
            }}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Choose a different name"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Field label="Find your name">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Start typing your name…"
          className="pl-9"
          autoComplete="off"
        />
      </div>
      {query.trim().length >= 2 && (
        <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-line">
          {searching && <p className="px-3 py-2 text-xs text-muted">Searching…</p>}
          {!searching && matches.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">
              No match. You can leave this blank and report anonymously.
            </p>
          )}
          {!searching &&
            matches.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick(m)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <span>{m.name}</span>
                <span className="text-xs text-muted">{m.companyName}</span>
              </button>
            ))}
        </div>
      )}
    </Field>
  );
}

export function SayForm() {
  const [state, formAction] = useActionState<PublicReportState, FormData>(reportIssuePublic, {});
  const [isTeamMember, setIsTeamMember] = useState(false);
  const [picked, setPicked] = useState<Match | null>(null);

  if (state.ok) {
    return (
      <div className="space-y-3 py-4 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
        <p className="text-base font-semibold text-slate-900">Thanks — that&apos;s been sent.</p>
        <p className="text-sm text-muted">
          The COLAB admin team has been notified and will take it from here. You can close this
          page.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Honeypot — hidden from people, tempting to bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-slate-50">
        <input
          type="checkbox"
          name="isTeamMember"
          checked={isTeamMember}
          onChange={(e) => {
            setIsTeamMember(e.target.checked);
            if (!e.target.checked) setPicked(null);
          }}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        <span>
          <span className="block text-sm font-medium text-slate-800">
            Are you a COLAB team member?
          </span>
          <span className="block text-xs text-muted">
            Tick to add your name, so we can come back to you. Leave it blank to report
            anonymously — either way it gets looked at.
          </span>
        </span>
      </label>

      {isTeamMember && (
        <>
          <WhoAreYou picked={picked} onPick={setPicked} />
          {picked && <input type="hidden" name="staffId" value={picked.id} />}
        </>
      )}

      <Field label="What sort of issue is it?">
        <Select name="category" defaultValue="" required>
          <option value="" disabled>
            Choose one…
          </option>
          {ISSUE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="What's wrong?">
        <Textarea
          name="detail"
          rows={5}
          required
          maxLength={3000}
          placeholder="Where is it, and what's the problem? e.g. “The tap in the upstairs kitchen won't turn off.”"
        />
      </Field>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <SubmitButton />
    </form>
  );
}
