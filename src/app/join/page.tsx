import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { ColabWordmark } from "@/components/logo";
import { JoinForm } from "./join-form";

export const metadata = { title: "Join the COLAB Team Hub" };

// Always render fresh so the company list reflects the live DB (and the build
// never depends on the database being reachable).
export const dynamic = "force-dynamic";

export default async function JoinPage() {
  const companyRows = await db
    .select({ id: companies.id, name: companies.name, type: companies.type })
    .from(companies)
    .where(eq(companies.active, true))
    .orderBy(asc(companies.type), asc(companies.name));

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <ColabWordmark size="lg" tone="light" />
          <p className="text-sm text-slate-400">Join the Team Hub</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-white p-6 shadow-xl">
          <JoinForm companies={companyRows} />
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          COLAB House · Where Retail Meets Results
        </p>
      </div>
    </div>
  );
}
