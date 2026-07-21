import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ColabWordmark } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — COLAB" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <ColabWordmark size="lg" tone="light" />
          <p className="text-sm text-slate-400">Billing &amp; Admin Control Centre</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-white p-6 shadow-xl">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          COLAB House · Where Retail Meets Results
        </p>
      </div>
    </div>
  );
}
