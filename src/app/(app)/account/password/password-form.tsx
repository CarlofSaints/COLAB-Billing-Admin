"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { changePassword, type PasswordState } from "@/app/actions/auth";
import { Input, Label } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/password-policy";
import { cn } from "@/lib/utils";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Update password"}
    </Button>
  );
}

export function PasswordForm({
  firstTime,
  // On the account page the form is one card among several, so it shouldn't
  // bounce the user to the dashboard on success.
  stayOnPage = false,
  // Only so the live hint can catch a password built out of the person's own
  // name or email. The server does this check for real.
  name,
  email,
}: {
  firstTime: boolean;
  stayOnPage?: boolean;
  name?: string;
  email?: string;
}) {
  const [state, action] = useActionState<PasswordState, FormData>(changePassword, {});
  const [next, setNext] = useState("");
  const router = useRouter();
  const problem = next.length > 0 ? passwordProblem(next, { name, email }) : null;

  useEffect(() => {
    if (state.ok && !stayOnPage) {
      const t = setTimeout(() => router.push("/"), 800);
      return () => clearTimeout(t);
    }
  }, [state.ok, router, stayOnPage]);

  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="current">Current password</Label>
        <Input id="current" name="current" type="password" required autoComplete="current-password" />
      </div>
      <div>
        <Label htmlFor="next">New password</Label>
        <Input
          id="next"
          name="next"
          type="password"
          required
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        {/* Live, so nobody types a password twice and only then finds out it
            was rejected. The server checks the same rule regardless — this is
            a courtesy, not the control. */}
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
      {state.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {stayOnPage ? "Password updated." : "Password updated. Redirecting…"}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Submit />
        {!firstTime && !stayOnPage && (
          <Button type="button" variant="ghost" onClick={() => router.push("/")}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
