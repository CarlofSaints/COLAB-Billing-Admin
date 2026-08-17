"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { resetPasswordWithToken, type ResetState } from "@/app/actions/password-reset";
import { Input, Label } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/password-policy";
import { cn } from "@/lib/utils";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "Save password and sign in"}
    </Button>
  );
}

export function ResetForm({
  token,
  name,
  email,
}: {
  token: string;
  // Only so the live hint can catch a password built out of the person's own
  // name or email. The server does this check for real.
  name: string;
  email: string;
}) {
  const [state, action] = useActionState<ResetState, FormData>(resetPasswordWithToken, {});
  const [next, setNext] = useState("");
  const problem = next.length > 0 ? passwordProblem(next, { name, email }) : null;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      {/* Hidden but present: password managers offer to save the new password
          against the right account only if the username is in the form. */}
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />

      <div>
        <Label htmlFor="next">New password</Label>
        <Input
          id="next"
          name="next"
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        {/* Live, so nobody types a password twice and only then finds out it
            was rejected — which on this page would also have burned the link
            if the server checked it after spending the token. It doesn't. */}
        <p
          className={cn(
            "mt-1.5 text-xs",
            next.length === 0 ? "text-muted" : problem ? "text-amber-700" : "text-emerald-700",
          )}
        >
          {next.length === 0
            ? `At least ${MIN_PASSWORD_LENGTH} characters. A short phrase you'll remember is stronger than a short jumble you won't.`
            : (problem ?? "That'll do nicely.")}
        </p>
      </div>

      <div>
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type="password" required autoComplete="new-password" />
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <Submit />
    </form>
  );
}
