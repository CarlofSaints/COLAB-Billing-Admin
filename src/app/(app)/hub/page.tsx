import { and, asc, eq, gte, sql } from "drizzle-orm";
import { Cake, Sparkles, CalendarDays } from "lucide-react";
import { db } from "@/db";
import { staff, companies, hubEvents } from "@/db/schema";
import { requirePermission, hasPermission } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page";
import { initials } from "@/lib/utils";
import { EventsManager } from "./events-manager";

export const metadata = { title: "Team Hub — COLAB" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// A clean, deterministic "joke of the day" — same joke for everyone each day,
// no external service. Indexed by day-of-year.
const JOKES: { q: string; a: string }[] = [
  { q: "Why did the spreadsheet go to therapy?", a: "It had too many unresolved cells." },
  { q: "Why don't scientists trust atoms?", a: "Because they make up everything." },
  { q: "What do you call a fake noodle?", a: "An impasta." },
  { q: "Why did the developer go broke?", a: "Because they used up all their cache." },
  { q: "How does a penguin build its house?", a: "Igloos it together." },
  { q: "Why did the coffee file a police report?", a: "It got mugged." },
  { q: "What do you call cheese that isn't yours?", a: "Nacho cheese." },
  { q: "Why was the maths book sad?", a: "It had too many problems." },
  { q: "What's an accountant's favourite day?", a: "Payday — everyone finally balances." },
  { q: "Why did the scarecrow win an award?", a: "It was outstanding in its field." },
  { q: "What do you call a bear with no teeth?", a: "A gummy bear." },
  { q: "Why don't eggs tell jokes?", a: "They'd crack each other up." },
  { q: "What did the ocean say to the beach?", a: "Nothing, it just waved." },
  { q: "Why did the bicycle fall over?", a: "It was two-tired." },
  { q: "What do you call a factory that makes okay products?", a: "A satisfactory." },
  { q: "Why did the printer go to the doctor?", a: "It had a paper jam." },
  { q: "How do you organise a space party?", a: "You planet." },
  { q: "Why was the calendar so popular?", a: "It had a lot of dates." },
  { q: "What's brown and sticky?", a: "A stick." },
  { q: "Why did the invoice blush?", a: "It saw the balance sheet." },
  { q: "What do you call a sleeping dinosaur?", a: "A dino-snore." },
  { q: "Why did the WiFi and the laptop get married?", a: "They had a great connection." },
  { q: "What do you call a fish wearing a bowtie?", a: "So-fish-ticated." },
  { q: "Why did the team photo take so long?", a: "Everyone wanted their best side." },
];

function dayOfYear(d: Date) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000);
}

export default async function HubPage() {
  const user = await requirePermission("hub.view");
  const canManage = hasPermission(user, "events.manage");

  const now = new Date();
  const month = now.getMonth() + 1;
  const today = now.toISOString().slice(0, 10);
  const joke = JOKES[dayOfYear(now) % JOKES.length];

  // Birthdays this month, sorted by day.
  const birthdays = await db
    .select({
      name: staff.name,
      dob: staff.dateOfBirth,
      favouriteColour: staff.favouriteColour,
      companyName: companies.name,
    })
    .from(staff)
    .leftJoin(companies, eq(staff.companyId, companies.id))
    .where(
      and(
        eq(staff.active, true),
        sql`${staff.dateOfBirth} is not null`,
        sql`extract(month from ${staff.dateOfBirth}) = ${month}`,
      ),
    )
    .orderBy(sql`extract(day from ${staff.dateOfBirth})`);

  const events = await db
    .select({
      id: hubEvents.id,
      title: hubEvents.title,
      description: hubEvents.description,
      eventDate: hubEvents.eventDate,
      location: hubEvents.location,
    })
    .from(hubEvents)
    .where(and(eq(hubEvents.active, true), gte(hubEvents.eventDate, today)))
    .orderBy(asc(hubEvents.eventDate))
    .limit(20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Hi {user.name.split(" ")[0]} 👋
        </h1>
        <p className="mt-1 text-sm text-muted">What&apos;s happening around COLAB.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Birthdays this month */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cake className="h-4 w-4 text-brand-700" /> Birthdays in {MONTHS[month - 1]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {birthdays.length === 0 ? (
              <p className="text-sm text-muted">No birthdays on the list this month.</p>
            ) : (
              <ul className="space-y-3">
                {birthdays.map((b, i) => {
                  const day = b.dob ? Number(b.dob.slice(8, 10)) : 0;
                  return (
                    <li key={i} className="flex items-center gap-3">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                        style={{ backgroundColor: b.favouriteColour || "#4f46e5" }}
                      >
                        {initials(b.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{b.name}</p>
                        {b.companyName && (
                          <p className="truncate text-xs text-muted">{b.companyName}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-sm font-medium text-brand-700">
                        {day} {MONTHS[month - 1].slice(0, 3)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Joke of the day */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-700" /> Joke of the day
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium text-slate-800">{joke.q}</p>
            <p className="mt-2 text-sm text-brand-700">{joke.a}</p>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming events */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-brand-700" /> Upcoming at COLAB
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 && !canManage ? (
            <EmptyState
              title="Nothing on the calendar yet"
              description="Check back soon for team happenings."
            />
          ) : (
            <EventsManager events={events} canManage={canManage} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
