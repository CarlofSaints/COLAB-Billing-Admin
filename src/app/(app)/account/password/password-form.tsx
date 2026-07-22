"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { changePassword, type PasswordState } from "@/app/actions/auth";
import { Input, Label } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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
}: {
  firstTime: boolean;
  stayOnPage?: boolean;
}) {
  const [state, action] = useActionState<PasswordState, FormData>(changePassword, {});
  const router = useRouter();

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
        <Input id="next" name="next" type="password" required autoComplete="new-password" />
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
