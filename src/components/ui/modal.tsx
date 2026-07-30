"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "./button";

/**
 * Lightweight controlled modal. A trigger button toggles it; children render
 * the body (typically a form using a Server Action).
 *
 * The dialog is capped at the viewport height and scrolls INSIDE itself, with
 * the header pinned. Letting it grow to fit its content instead pushed the
 * title and the close button above the top of the screen — and a centred flex
 * child taller than its container cannot be scrolled back to, so Escape became
 * the only way out. `dvh` rather than `vh` so a phone's collapsing address bar
 * doesn't bring it back.
 */
export function Modal({
  title,
  description,
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  wide,
}: {
  title: string;
  description?: string;
  trigger?: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  wide?: boolean;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = (v: boolean) => {
    setUncontrolled(v);
    onOpenChange?.(v);
  };
  const close = () => setOpen(false);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {trigger && (
        <span onClick={() => setOpen(true)} className="contents">
          {trigger}
        </span>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center">
          <div
            className={`flex max-h-[calc(100dvh-2rem)] w-full flex-col ${
              wide ? "max-w-2xl" : "max-w-lg"
            } rounded-xl border border-line bg-white shadow-xl`}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
              </div>
              <Button variant="ghost" size="sm" onClick={close} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {typeof children === "function" ? children(close) : children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
