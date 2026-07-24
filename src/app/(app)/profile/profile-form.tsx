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

export function ProfileForm({
  bio,
  dateOfBirth,
  favouriteColour,
  hobbies,
}: {
  bio: string | null;
  dateOfBirth: string | null;
  favouriteColour: string | null;
  hobbies: string[] | null;
}) {
  const [state, action] = useActionState<ProfileState, FormData>(updateMyProfile, {});
  const [colour, setColour] = useState(favouriteColour || "#4f46e5");

  return (
    <form action={action} className="space-y-5">
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
