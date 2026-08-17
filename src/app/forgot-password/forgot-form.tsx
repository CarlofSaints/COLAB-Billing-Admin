"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { MailCheck, TriangleAlert } from "lucide-react";
import { requestPasswordReset, type ForgotState } from "@/app/actions/password-reset";
import { Input, Label } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Sending…" : "Email me a reset link"}
    </Button>
  );
}

export function ForgotForm() {
  const [state, action] = useActionState<ForgotState, FormData>(requestPasswordReset, {});

  // The success state deliberately says the same thing whether or not the
  // address has an account — see the note in actions/password-reset.ts.
  if (state.sent) {
    return (
      <div className="space-y-3 text-center">
        <MailCheck className="mx-auto h-10 w-10 text-emerald-500" />
        <h2 className="text-lg font-semibold text-slate-900">Check your email</h2>
        <p className="text-sm text-slate-600">{state.sent}</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div className="mb-2 text-center">
        <h2 className="text-lg font-semibold text-slate-900">Forgot your password?</h2>
        <p className="mt-1 text-sm text-muted">
          Enter the email address you sign in with and we&apos;ll send you a link to choose a new
          password.
        </p>
      </div>

      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="you@company.co.za"
        />
      </div>

      {state.error && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </p>
      )}

      <Submit />
    </form>
  );
}
