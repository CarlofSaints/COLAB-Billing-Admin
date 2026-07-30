import { ColabWordmark } from "@/components/logo";
import { SayForm } from "./say-form";

export const metadata = {
  title: "Say Something — COLAB",
  description: "Report anything that needs fixing around the office.",
};

/**
 * The public "See something, say something" page, reached by scanning a
 * sticker rather than by signing in.
 *
 * Short, memorable path on purpose — `/say` has to survive being read off a
 * wall and typed by hand when a camera won't cooperate.
 *
 * Nothing is queried here: the team list is fetched only in response to a
 * search, so scanning the code never hands anyone a staff directory.
 */
export const dynamic = "force-dynamic";

export default function SayPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <ColabWordmark size="lg" tone="light" />
          <p className="text-lg font-semibold text-white">See something? Say something!</p>
          <p className="text-sm text-slate-400">
            Something broken, leaking, flickering or just not right? Tell us — it takes a few
            seconds and you don&apos;t need an account.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-white p-6 shadow-xl">
          <SayForm />
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          COLAB House · Where Retail Meets Results
        </p>
      </div>
    </div>
  );
}
