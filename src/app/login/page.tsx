import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LogoMark } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — COLAB" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <LogoMark className="h-12 w-12" />
          <div>
            <h1 className="text-xl font-bold tracking-wide text-white">COLAB</h1>
            <p className="text-sm text-slate-400">Billing &amp; Admin Control Centre</p>
          </div>
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
