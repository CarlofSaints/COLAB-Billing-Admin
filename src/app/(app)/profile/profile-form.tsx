"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { updateMyProfile, type ProfileState } from "@/app/actions/profile";
import { Input, Textarea, Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save profile"}
    </Button>
  );
}

/**
 * The team-hub half of a person's details (photo, bio, birthday, hobbies).
 * Named distinctly from the account `ProfileForm`, which handles sign-in name
 * and email — both now render on /account and the collision was confusing.
 */
export function HubProfileForm({
  name,
  cellNumber,
  gender,
  position,
  companyName,
  bio,
  dateOfBirth,
  favouriteColour,
  hobbies,
}: {
  name: string;
  cellNumber: string | null;
  gender: string | null;
  position: string | null;
  companyName: string | null;
  bio: string | null;
  dateOfBirth: string | null;
  favouriteColour: string | null;
  hobbies: string[] | null;
}) {
  const [state, action] = useActionState<ProfileState, FormData>(updateMyProfile, {});
  const [colour, setColour] = useState(favouriteColour || "#4f46e5");

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" hint="As it appears on the team list.">
          <Input name="name" defaultValue={name} required maxLength={120} />
        </Field>
        <Field label="Job title" hint="What you do here.">
          <Input name="position" defaultValue={position ?? ""} maxLength={120} />
        </Field>
        <Field label="Cell number">
          <Input name="cellNumber" type="tel" defaultValue={cellNumber ?? ""} maxLength={40} />
        </Field>
        <Field label="Gender">
          {/* Free text, not a fixed list — the column always has been, and a
              closed list here would quietly exclude whatever people use. */}
          <Input name="gender" defaultValue={gender ?? ""} maxLength={40} />
        </Field>
      </div>

      {/* Shown, not editable: which company you belong to is a decision made
          for you, and it feeds the billing split. Same for tags. */}
      <p className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-xs text-muted">
        You&apos;re listed under <strong className="text-slate-700">{companyName ?? "no company"}</strong>.
        Your sub-company, tags and billing settings are set by an admin — ask if any of them look
        wrong. Your sign-in email is changed under <strong className="text-slate-700">Sign-in details</strong> above.
      </p>

      <Field
        label="What I do at COLAB"
        hint="A sentence or two about your role and what you get up to."
      >
        <Textarea name="bio" defaultValue={bio ?? ""} maxLength={2000} rows={3} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date of birth" hint="Used for birthday shout-outs on the hub.">
          <Input name="dateOfBirth" type="date" defaultValue={dateOfBirth ?? ""} />
        </Field>

        <Field label="Favourite colour" hint="Themes your avatar.">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-white p-1"
              aria-label="Favourite colour"
            />
            <span className="text-sm text-muted">{colour}</span>
            <input type="hidden" name="favouriteColour" value={colour} />
          </div>
        </Field>
      </div>

      <Field label="Hobbies" hint="Comma-separated, e.g. Hiking, Padel, Baking.">
        <Input name="hobbies" defaultValue={(hobbies ?? []).join(", ")} />
      </Field>

      {state.error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="h-4 w-4" /> {state.error}
        </p>
      )}
      {state.ok && (
        <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> Profile saved.
        </p>
      )}

      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
