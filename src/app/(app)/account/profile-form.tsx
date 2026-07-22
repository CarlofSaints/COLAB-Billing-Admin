"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { updateProfile, type ProfileState } from "@/app/actions/auth";
import { Input, Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action] = useActionState<ProfileState, FormData>(updateProfile, {});
  const [nextEmail, setNextEmail] = useState(email);
  const emailChanged = nextEmail.trim().toLowerCase() !== email.toLowerCase();

  return (
    <form action={action} className="space-y-4">
      <Field label="Your name" hint="Shown in the sidebar and against everything you do in the log.">
        <Input name="name" defaultValue={name} required />
      </Field>

      <Field label="Email address" hint="This is what you sign in with.">
        <Input
          name="email"
          type="email"
          value={nextEmail}
          onChange={(e) => setNextEmail(e.target.value)}
          required
        />
      </Field>

      {emailChanged && (
        <Field
          label="Confirm your password"
          hint="Changing your sign-in email needs your password."
        >
          <Input name="password" type="password" required autoComplete="current-password" />
        </Field>
      )}

      {state.error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="h-4 w-4" /> {state.error}
        </p>
      )}
      {state.ok && (
        <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> Profile updated.
        </p>
      )}

      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
