import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { ColabWordmark } from "@/components/logo";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Forgot your password — COLAB" };

/**
 * Public by design — it sits outside the (app) group precisely so it needs no
 * guard. Somebody who has forgotten their password cannot be signed in, so
 * there is no role to check.
 */
export default async function ForgotPasswordPage() {
  const user = await getCurrentUser();
  // Already signed in? Then this isn't the page they want — the Account page
  // changes a password you still know, without the email round trip.
  if (user) redirect("/account/password");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <ColabWordmark size="lg" tone="light" />
          <p className="text-sm text-slate-400">Billing &amp; Admin Control Centre</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-white p-6 shadow-xl">
          <ForgotForm />
        </div>

        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="text-slate-400 hover:text-white hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
