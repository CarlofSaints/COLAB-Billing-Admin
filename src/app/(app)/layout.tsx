import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    // `h-dvh`, not `h-screen`: on a phone `vh` is the height with the address
    // bar hidden, so the last few rows of every page sat under the browser
    // chrome. The same reason the modals use dvh.
    <div className="flex h-dvh overflow-hidden">
      <Sidebar user={user} />
      {/* pt-14 clears the fixed phone top bar; from md the nav is a rail again
          and the padding goes away with it. */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">{children}</div>
      </main>
    </div>
  );
}
