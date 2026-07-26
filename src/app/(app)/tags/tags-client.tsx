"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Pencil, Trash2, Tag as TagIcon, TriangleAlert } from "lucide-react";
import { createTag, updateTag, deleteTag, type TagState } from "@/app/actions/tags";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { TagChip } from "@/components/tag-chip";

type TagRow = { id: number; name: string; color: string | null; count: number };

const DEFAULT_COLOR = "#4f46e5";

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function TagForm({ tag, onDone }: { tag?: TagRow; onDone: () => void }) {
  const editing = !!tag;
  const [state, action] = useActionState<TagState, FormData>(editing ? updateTag : createTag, {});
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? DEFAULT_COLOR);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="space-y-4">
      {editing && <input type="hidden" name="id" value={tag.id} />}
      <Field label="Tag name">
        <Input name="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Colour">
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-white p-1"
            aria-label="Tag colour"
          />
          <input type="hidden" name="color" value={color} />
          <TagChip name={name || "Preview"} color={color} />
        </div>
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
        <SaveButton label={editing ? "Save changes" : "Create tag"} />
      </div>
    </form>
  );
}

function RowActions({ tag }: { tag: TagRow }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-1">
      <Modal
        title="Edit tag"
        open={editing}
        onOpenChange={setEditing}
        trigger={
          <Button variant="ghost" size="sm" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        }
      >
        <TagForm tag={tag} onDone={() => setEditing(false)} />
      </Modal>
      <Button
        variant="ghost"
        size="sm"
        title="Delete"
        disabled={pending}
        onClick={() => {
          if (confirm(`Delete the "${tag.name}" tag? It will be removed from everyone who has it.`))
            start(() => deleteTag(tag.id));
        }}
      >
        <Trash2 className="h-3.5 w-3.5 text-red-500" />
      </Button>
    </div>
  );
}

export function TagsClient({ tags }: { tags: TagRow[] }) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Modal
          title="New tag"
          open={adding}
          onOpenChange={setAdding}
          trigger={
            <Button>
              <Plus className="h-4 w-4" /> Add tag
            </Button>
          }
        >
          <TagForm onDone={() => setAdding(false)} />
        </Modal>
      </div>

      {tags.length === 0 ? (
        <EmptyState
          icon={<TagIcon className="h-8 w-8" />}
          title="No tags yet"
          description="Create your first tag, then apply it to team members."
          action={<Button onClick={() => setAdding(true)}>Add tag</Button>}
        />
      ) : (
        <Card className="divide-y divide-line">
          {tags.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <TagChip name={t.name} color={t.color} />
                <span className="text-xs text-muted">
                  {t.count} {t.count === 1 ? "person" : "people"}
                </span>
              </div>
              <RowActions tag={t} />
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
