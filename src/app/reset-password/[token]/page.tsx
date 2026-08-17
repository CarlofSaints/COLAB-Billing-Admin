import Link from "next/link";
import { KeyRound, LinkIcon } from "lucide-react";
import { ColabWordmark } from "@/components/logo";
import { checkResetToken } from "@/lib/password-reset";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Choose a new password — COLAB" };

// The token is checked against the database on every view, so nothing here may
// be cached or prerendered.
export const dynamic = "force-dynamic";

/**
 * Where the emailed reset link lands.
 *
 * ⚠️ Unlike the swap / steal tokens elsewhere, THIS TOKEN AUTHENTICATES — no
 * sign-in is required or possible, holding the link is the proof. That's why it
 * expires, is single-use, and is stored only as a hash.
 *
 * Public by design: it lives outside the (app) group so it needs no guard.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const check = await checkResetToken(token);

  // One message for unknown / used / expired. Whether a token was never real,
  // already spent or simply old is nothing the holder needs to know, and the
  // answer in every case is the same: ask for another one.
  const deadReason =
    check.ok === false
      ? check.reason === "disabled"
        ? "That account has been disabled, so there's no password worth setting. Ask the COLAB office to enable it first."
        : "This link has expired or has already been used. Reset links are good for one use, and only for an hour."
      : null;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <ColabWordmark size="lg" tone="light" />
          <p className="text-sm text-slate-400">Billing &amp; Admin Control Centre</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-white p-6 shadow-xl">
          {check.ok ? (
            <>
              <div className="mb-4 text-center">
                <KeyRound className="mx-auto mb-3 h-9 w-9 text-brand-600" />
                <h2 className="text-lg font-semibold text-slate-900">Choose a new password</h2>
                <p className="mt-1 text-sm text-muted">
                  For <span className="font-medium text-slate-700">{check.email}</span>. Once you
                  save it you&apos;ll be signed in.
                </p>
              </div>
              <ResetForm token={token} name={check.name} email={check.email} />
            </>
          ) : (
            <div className="space-y-4 text-center">
              <LinkIcon className="mx-auto h-9 w-9 text-amber-500" />
              <h2 className="text-lg font-semibold text-slate-900">This link no longer works</h2>
              <p className="text-sm text-slate-600">{deadReason}</p>
              {check.reason !== "disabled" && (
                <Link href="/forgot-password" className="block">
                  <span className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-800">
                    Send me a new link
                  </span>
                </Link>
              )}
            </div>
          )}
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
