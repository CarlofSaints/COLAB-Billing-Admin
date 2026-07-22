"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, TriangleAlert } from "lucide-react";
import { revealValues, hideValues, type RevealResult } from "@/app/actions/sensitive";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Field } from "@/components/ui/field";
import { formatCurrency, cn } from "@/lib/utils";

/**
 * Renders a rand amount, or a mask when it's restricted. A masked value
 * arrives as null — the real figure is never sent to the browser — so the
 * only way to see it is to unlock, which re-renders from the server.
 */
export function SensitiveAmount({
  amount,
  canUnlock,
  className,
}: {
  amount: number | null;
  canUnlock: boolean;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);

  if (amount !== null) {
    return <span className={className}>{formatCurrency(amount)}</span>;
  }

  return (
    <>
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <span className="tracking-widest text-slate-400" title="Restricted value">
          •••••
        </span>
        {canUnlock && (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            title="View restricted value"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
      {asking && <UnlockModal onDone={() => setAsking(false)} />}
    </>
  );
}

function UnlockButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Checking…" : "View amounts"}
    </Button>
  );
}

export function UnlockModal({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [state, action] = useActionState<RevealResult, FormData>(revealValues, {});

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onDone();
    }
  }, [state.ok, router, onDone]);

  return (
    <Modal title="View restricted values" open onOpenChange={(o) => !o && onDone()}>
      <form action={action} className="space-y-4">
        <p className="flex items-start gap-2 text-sm text-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          Enter your password to reveal restricted amounts. They stay visible for 15 minutes, and
          the fact that you viewed them is recorded in the activity log.
        </p>
        <Field label="Your password">
          <Input name="password" type="password" required autoFocus autoComplete="current-password" />
        </Field>
        {state.error && (
          <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <TriangleAlert className="h-4 w-4" /> {state.error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <UnlockButton />
        </div>
      </form>
    </Modal>
  );
}

/** Header control showing whether restricted values are currently visible. */
export function RevealToggle({ unlocked, canUnlock }: { unlocked: boolean; canUnlock: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  if (!canUnlock) return null;

  return (
    <>
      {unlocked ? (
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await hideValues();
            router.refresh();
          }}
        >
          <EyeOff className="h-4 w-4" /> Hide restricted values
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
          <Eye className="h-4 w-4" /> Show restricted values
        </Button>
      )}
      {asking && <UnlockModal onDone={() => setAsking(false)} />}
    </>
  );
}
