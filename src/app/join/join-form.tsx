"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { submitSignupRequest, type SignupState } from "@/app/actions/team";
import { Input, Select, Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

type CompanyOpt = { id: number; name: string; type: "colab" | "sub" };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Sending…" : "Request to join"}
    </Button>
  );
}

export function JoinForm({ companies }: { companies: CompanyOpt[] }) {
  const [state, action] = useActionState<SignupState, FormData>(submitSignupRequest, {});
  const colab = companies.filter((c) => c.type === "colab");
  const subs = companies.filter((c) => c.type === "sub");

  if (state.ok) {
    return (
      <div className="space-y-3 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
        <h2 className="text-lg font-semibold text-slate-900">Request sent</h2>
        <p className="text-sm text-slate-600">
          Thanks! Someone at COLAB will approve your request shortly. Once they do, you&apos;ll get
          an email with a link to set up your profile.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div className="mb-2 text-center">
        <h2 className="text-lg font-semibold text-slate-900">Tell us who you are</h2>
        <p className="mt-1 text-sm text-muted">
          New to a COLAB company? Fill this in to get onto the Team Hub.
        </p>
      </div>

      <Field label="Full name">
        <Input name="name" required autoFocus placeholder="Thabo Mokoena" />
      </Field>

      <Field label="Work email" hint="This is what you'll sign in with.">
        <Input name="email" type="email" required placeholder="you@company.co.za" />
      </Field>

      <Field label="Which company are you with?">
        <Select name="companyId" defaultValue="" required>
          <option value="" disabled>
            Select your company…
          </option>
          {colab.length > 0 && (
            <optgroup label="COLAB">
              {colab.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Companies">
            {subs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>

      {state.error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="h-4 w-4" /> {state.error}
        </p>
      )}

      <Submit />
    </form>
  );
}
