"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Users, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { TagChip } from "@/components/tag-chip";
import { cn, initials } from "@/lib/utils";

export type Person = {
  id: number;
  name: string;
  position: string;
  companyName: string;
  companyColour: string;
  bio: string;
  hobbies: string[];
  hasPhoto: boolean;
  favouriteColour: string;
  tags: { id: number; name: string; color: string | null }[];
};

/**
 * The directory grid. Client-side only so the search and the company filter
 * are instant — the whole team is a small enough list to hand over in one go,
 * and paging it would make finding someone harder, not easier.
 *
 * Read-only by design: no action ever fires from this page.
 */
export function DirectoryClient({
  people,
  companyNames,
}: {
  people: Person[];
  companyNames: string[];
}) {
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState<string | null>(null);
  // Held here rather than per card so only one photo can ever be open, and so
  // filtering the list while one is up doesn't leave an orphan overlay.
  const [enlarged, setEnlarged] = useState<Person | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (company && p.companyName !== company) return false;
      if (!q) return true;
      // Hobbies and tags are searchable too — "who else plays padel?" is
      // exactly the question this page exists to answer.
      return [p.name, p.position, p.companyName, p.bio, ...p.hobbies, ...p.tags.map((t) => t.name)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [people, query, company]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, role, hobby or tag…"
            className="pl-9"
            aria-label="Search the team"
          />
        </div>
        <span className="text-sm text-muted">
          {filtered.length} of {people.length}
        </span>
      </div>

      {/* Company filter — brand-coloured, so it reads as the sub-companies
          rather than as a generic set of buttons. */}
      {companyNames.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <FilterPill active={company === null} onClick={() => setCompany(null)}>
            Everyone
          </FilterPill>
          {companyNames.map((name) => {
            const active = company === name;
            const colour = people.find((p) => p.companyName === name)?.companyColour ?? "#64748b";
            return (
              <FilterPill
                key={name}
                active={active}
                colour={colour}
                onClick={() => setCompany(active ? null : name)}
              >
                {name}
              </FilterPill>
            );
          })}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="Nobody matches that"
          description="Try a different name, role or hobby."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <PersonCard key={p.id} person={p} onEnlarge={() => setEnlarged(p)} />
          ))}
        </div>
      )}

      {enlarged && <PhotoLightbox person={enlarged} onClose={() => setEnlarged(null)} />}
    </div>
  );
}

/**
 * The blown-up profile photo.
 *
 * Its own overlay rather than the shared `Modal`, which is a white card with a
 * titled header — a photo wants the frame out of the way. Same URL as the
 * thumbnail, so the browser almost always has it cached and it opens instantly.
 */
function PhotoLightbox({ person: p, onClose }: { person: Person; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      // Clicking anywhere closes it. The image itself stops the event, so
      // clicking the photo to look closer doesn't dismiss the thing you're
      // looking at.
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-900/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo of ${p.name}`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/photo/${p.id}`}
        alt={p.name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[75dvh] max-w-full rounded-xl object-contain shadow-2xl"
      />

      <div className="text-center" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-semibold text-white">{p.name}</p>
        {p.position && <p className="text-sm text-white/70">{p.position}</p>}
        <p className="mt-1 text-xs font-medium" style={{ color: p.companyColour }}>
          {p.companyName}
        </p>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  colour,
  onClick,
  children,
}: {
  active: boolean;
  colour?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const c = colour ?? "#475569";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        !active && "border-line bg-white text-slate-600 hover:bg-slate-50",
      )}
      style={active ? { backgroundColor: `${c}1f`, color: c, borderColor: `${c}66` } : undefined}
    >
      {children}
    </button>
  );
}

function PersonCard({ person: p, onEnlarge }: { person: Person; onEnlarge: () => void }) {
  // A real button only when there's a photo behind it. Someone with no picture
  // has nothing to enlarge, and offering the click would land them on a giant
  // pair of initials.
  const Avatar = p.hasPhoto ? "button" : "div";

  return (
    <Card className="flex flex-col overflow-hidden bg-white/90 backdrop-blur-sm">
      {/* A thin band in the sub-company's colour — the fastest way to see who
          belongs where without reading a word. */}
      <div className="h-1.5 w-full" style={{ backgroundColor: p.companyColour }} />

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <Avatar
            {...(p.hasPhoto
              ? {
                  type: "button" as const,
                  onClick: onEnlarge,
                  "aria-label": `See ${p.name}'s photo full size`,
                  title: "Click to enlarge",
                }
              : {})}
            className={cn(
              "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full text-base font-semibold text-white",
              p.hasPhoto &&
                "cursor-zoom-in ring-brand-600/0 transition hover:ring-2 hover:ring-brand-600/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
            )}
            style={{ backgroundColor: p.favouriteColour }}
          >
            {p.hasPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/photo/${p.id}`}
                alt={p.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              initials(p.name)
            )}
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-slate-900">{p.name}</p>
            {p.position && <p className="text-sm text-slate-600">{p.position}</p>}
            <p className="mt-1 text-xs font-medium" style={{ color: p.companyColour }}>
              {p.companyName}
            </p>
          </div>
        </div>

        {p.bio && <p className="text-sm leading-relaxed text-slate-700">{p.bio}</p>}

        {p.hobbies.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Hobbies
            </p>
            <div className="flex flex-wrap gap-1.5">
              {p.hobbies.map((h, i) => (
                <span
                  key={`${h}-${i}`}
                  className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700"
                >
                  {h}
                </span>
              ))}
            </div>
          </div>
        )}

        {p.tags.length > 0 && (
          // Pushed to the bottom so the tag row lines up across a row of cards
          // however much bio each person wrote.
          <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
            {p.tags.map((t) => (
              <TagChip key={t.id} name={t.name} color={t.color} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
