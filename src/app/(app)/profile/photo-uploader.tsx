"use client";

import { useRef, useState, useTransition } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { uploadProfilePhoto, removeProfilePhoto } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/utils";

export function PhotoUploader({
  staffId,
  name,
  hasPhoto,
  favouriteColour,
}: {
  staffId: number;
  name: string;
  hasPhoto: boolean;
  favouriteColour: string | null;
}) {
  const [showPhoto, setShowPhoto] = useState(hasPhoto);
  const [bust, setBust] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setOk(false);
    start(async () => {
      const r = await uploadProfilePhoto({}, fd);
      if (r.error) {
        setError(r.error);
      } else {
        setOk(true);
        setShowPhoto(true);
        setBust((b) => b + 1);
        formRef.current?.reset();
      }
    });
  }

  function onRemove() {
    setError(null);
    setOk(false);
    start(async () => {
      await removeProfilePhoto();
      setShowPhoto(false);
      setBust((b) => b + 1);
    });
  }

  return (
    <div className="flex items-center gap-4">
      <div
        className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full text-lg font-semibold text-white"
        style={{ backgroundColor: favouriteColour || "#4f46e5" }}
      >
        {showPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/photo/${staffId}?v=${bust}`}
            alt={name}
            className="h-full w-full object-cover"
          />
        ) : (
          initials(name)
        )}
      </div>

      <div className="space-y-1.5">
        <form ref={formRef} onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
          <input
            name="photo"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            required
            className="max-w-[200px] text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Uploading…" : "Upload"}
          </Button>
          {showPhoto && (
            <button
              type="button"
              disabled={pending}
              onClick={onRemove}
              className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </form>

        {error ? (
          <p className="flex items-center gap-1 text-xs text-red-600">
            <TriangleAlert className="h-3 w-3" /> {error}
          </p>
        ) : ok ? (
          <p className="flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> Photo updated.
          </p>
        ) : (
          <p className="text-xs text-muted">JPG, PNG, WebP or GIF, up to 5 MB.</p>
        )}
      </div>
    </div>
  );
}
