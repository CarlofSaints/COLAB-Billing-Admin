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
import { formatCurrency } from "@/lib/utils";

type TagRow = {
  id: number;
  name: string;
  color: string | null;
  count: number;
  /** null = a label-only tag; a number = billed per tagged person per month. */
  costPerPerson: number | null;
  /** Per sub-company counts of the people this tag would actually bill. */
  billable: { companyName: string; count: number }[];
  billableCount: number;
};

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
  const [cost, setCost] = useState(tag?.costPerPerson?.toString() ?? "");

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const parsedCost = cost.trim() === "" ? null : Number(cost);
  const costNumber =
    parsedCost !== null && Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : null;
  const heads = tag?.billableCount ?? 0;
  const hadCost = tag?.costPerPerson != null;

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
      <Field
        label="Cost per person, per month"
        hint="Leave blank for a label-only tag like Reception. Enter an amount and the tag bills: each sub-company is charged for the people it has tagged, on the recurring run."
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">R</span>
          <Input
            name="costPerPerson"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 850"
            className="max-w-40"
          />
        </div>
      </Field>
      {costNumber !== null && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {heads > 0 ? (
            <>
              <strong>{heads}</strong> tagged {heads === 1 ? "person" : "people"} ×{" "}
              {formatCurrency(costNumber)} ={" "}
              <strong>{formatCurrency(heads * costNumber)}</strong> a month, billed across the
              sub-companies.
            </>
          ) : (
            <>
              Nobody carries this tag yet, so it will bill nothing until you apply it on the Team
              Members page.
            </>
          )}
        </p>
      )}
      {editing && hadCost && cost.trim() === "" && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Clearing the cost stops this billing. Its recurring line item is kept but deactivated, so
          any expense account linked to it stays linked.
        </p>
      )}
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
            <div key={t.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <TagChip name={t.name} color={t.color} />
                  <span className="text-xs text-muted">
                    {t.count} {t.count === 1 ? "person" : "people"}
                  </span>
                  {t.costPerPerson !== null && (
                    <span className="text-xs font-medium text-brand-700">
                      {formatCurrency(t.costPerPerson)} each ={" "}
                      {formatCurrency(t.billableCount * t.costPerPerson)} / month
                    </span>
                  )}
                </div>
                <RowActions tag={t} />
              </div>
              {/* Where a billable tag's money actually lands, so the recurring
                  invoice holds no surprises. */}
              {t.costPerPerson !== null && t.billable.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-1 text-xs text-muted">
                  {t.billable.map((b) => (
                    <span key={b.companyName}>
                      {b.companyName} ×{b.count} ={" "}
                      <span className="font-medium text-slate-700">
                        {formatCurrency(b.count * t.costPerPerson!)}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {t.costPerPerson !== null && t.billableCount === 0 && (
                <p className="mt-2 pl-1 text-xs text-amber-700">
                  Billable, but nobody billable carries it yet — it charges nothing.
                </p>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
