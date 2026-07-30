"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { EyeOff, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import {
  saveIssueCategory,
  saveIssuePlace,
  setIssueCategoryActive,
  setIssuePlaceActive,
  deleteIssueCategory,
  deleteIssuePlace,
  type SetupState,
} from "@/app/actions/issue-setup";
import { Button } from "@/components/ui/button";
import { Input, Field, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type ListItem = {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
};

type Kind = "category" | "place";

const COPY = {
  category: {
    label: "issue type",
    plural: "Issue types",
    hint: "What people choose when reporting. Anything hidden stops being offered on the form, but old tickets keep it.",
    placeholder: "e.g. Something is finished",
    descPlaceholder: "Optional hint, e.g. toilet paper, coffee, milk",
  },
  place: {
    label: "place",
    plural: "Places",
    hint: "Optional on the report form — but naming where it is makes it much quicker to fix.",
    placeholder: "e.g. Third-floor kitchen",
    descPlaceholder: "Optional note, e.g. next to the lifts",
  },
} as const;

/**
 * Add/edit/hide/remove for the two lists behind the issue form.
 *
 * Both lists behave identically, so one component drives both rather than two
 * that drift apart. "Remove" only really deletes an entry nothing has used —
 * otherwise the server hides it and says so, because deleting a type in use
 * would blank it on every historical ticket.
 */
export function IssueListsManager({
  kind,
  items,
}: {
  kind: Kind;
  items: ListItem[];
}) {
  const copy = COPY[kind];
  const save = kind === "category" ? saveIssueCategory : saveIssuePlace;
  const setActive = kind === "category" ? setIssueCategoryActive : setIssuePlaceActive;
  const remove = kind === "category" ? deleteIssueCategory : deleteIssuePlace;

  const [state, formAction] = useActionState<SetupState, FormData>(save, {});
  const [editing, setEditing] = useState<ListItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (state.ok) {
      setEditing(null);
      setAdding(false);
    }
  }, [state.ok]);

  const open = adding || editing != null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{copy.hint}</p>

      {notice && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {notice}
        </p>
      )}

      {/* Scrolls on its own so the Add button and the edit form stay put as
          the list grows — otherwise every entry added pushes them further
          down the dialog. */}
      <div className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {items.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted">Nothing on the list yet.</p>
        )}
        {items.map((it) => (
          <div
            key={it.id}
            className={cn(
              "flex items-center justify-between gap-3 px-3 py-2",
              !it.active && "bg-slate-50",
            )}
          >
            <div className="min-w-0">
              <p
                className={cn(
                  "truncate text-sm font-medium",
                  it.active ? "text-slate-800" : "text-slate-400 line-through",
                )}
              >
                {it.name}
              </p>
              {it.description && <p className="truncate text-xs text-muted">{it.description}</p>}
              {!it.active && (
                <p className="text-xs text-amber-700">Hidden — not offered on the form</p>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                title="Rename"
                onClick={() => {
                  setNotice(null);
                  setAdding(false);
                  setEditing(it);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title={it.active ? "Hide from the form" : "Show on the form again"}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setNotice(null);
                    await setActive(it.id, !it.active);
                  })
                }
              >
                {it.active ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5 text-green-600" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title="Remove"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setNotice(null);
                    if (!confirm(`Remove “${it.name}”?`)) return;
                    const res = await remove(it.id);
                    // Not an error — the server hid it instead of deleting,
                    // and that's worth saying out loud.
                    if (res.error) setNotice(res.error);
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {!open && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setNotice(null);
            setAdding(true);
          }}
        >
          <Plus className="h-4 w-4" /> Add {copy.label}
        </Button>
      )}

      {open && (
        <form action={formAction} className="space-y-3 rounded-lg border border-line bg-slate-50 p-3">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <Field label={editing ? `Rename ${copy.label}` : `New ${copy.label}`}>
            <Input
              name="name"
              defaultValue={editing?.name ?? ""}
              placeholder={copy.placeholder}
              required
              autoFocus
              maxLength={60}
            />
          </Field>
          <Field label="Description (optional)">
            <Textarea
              name="description"
              rows={2}
              defaultValue={editing?.description ?? ""}
              placeholder={copy.descPlaceholder}
            />
          </Field>
          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm">
              {editing ? "Save" : `Add ${copy.label}`}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
