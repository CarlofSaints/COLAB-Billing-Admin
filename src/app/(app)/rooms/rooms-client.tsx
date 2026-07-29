"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Pencil, DoorOpen, Users, TriangleAlert, Archive, RotateCcw } from "lucide-react";
import { saveRoom, setRoomActive, type RoomState } from "@/app/actions/rooms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Field, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";

type RoomRow = {
  id: number;
  name: string;
  capacity: number;
  color: string | null;
  notes: string;
  active: boolean;
  bookingCount: number;
};

const DEFAULT_COLOR = "#0d9488";
const SWATCHES = ["#0d9488", "#4f46e5", "#db2777", "#ea580c", "#0284c7", "#65a30d"];

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function RoomForm({ room, onDone }: { room?: RoomRow; onDone: () => void }) {
  const editing = !!room;
  const [state, action] = useActionState<RoomState, FormData>(saveRoom, {});
  const [color, setColor] = useState(room?.color ?? DEFAULT_COLOR);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="space-y-4">
      {editing && <input type="hidden" name="id" value={room.id} />}
      <Field label="Room name">
        <Input name="name" defaultValue={room?.name ?? ""} required autoFocus maxLength={60} />
      </Field>
      <Field label="Max capacity" hint="Nobody can book this room for more people than it seats.">
        <Input
          name="capacity"
          type="number"
          min={1}
          max={500}
          defaultValue={room?.capacity ?? 6}
          required
          className="max-w-32"
        />
      </Field>
      <Field label="Colour" hint="How this room's bookings are tinted on the calendar.">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-white p-1"
            aria-label="Room colour"
          />
          <input type="hidden" name="color" value={color} />
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Use ${c}`}
              className="h-6 w-6 rounded-full border-2"
              style={{ backgroundColor: c, borderColor: color === c ? "#0f172a" : "transparent" }}
            />
          ))}
        </div>
      </Field>
      <Field label="Notes" hint="Optional — a projector, a whiteboard, whatever is worth knowing.">
        <Textarea name="notes" defaultValue={room?.notes ?? ""} maxLength={300} rows={2} />
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
        <SaveButton label={editing ? "Save changes" : "Add room"} />
      </div>
    </form>
  );
}

export function RoomsClient({ rooms }: { rooms: RoomRow[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RoomRow | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add room
        </Button>
      </div>

      {rooms.length === 0 ? (
        <EmptyState
          icon={<DoorOpen className="h-8 w-8" />}
          title="No rooms yet"
          description="Add your meeting rooms and people can start booking them."
          action={<Button onClick={() => setAdding(true)}>Add room</Button>}
        />
      ) : (
        <Card className="divide-y divide-line">
          {rooms.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="h-8 w-8 shrink-0 rounded-lg border"
                  style={{
                    backgroundColor: `${r.color ?? DEFAULT_COLOR}22`,
                    borderColor: `${r.color ?? DEFAULT_COLOR}66`,
                  }}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{r.name}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-muted">
                      <Users className="h-3 w-3" /> seats {r.capacity}
                    </span>
                    {!r.active && <Badge tone="slate">Retired</Badge>}
                  </div>
                  {r.notes && <p className="truncate text-xs text-muted">{r.notes}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" title="Edit" onClick={() => setEditing(r)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  title={r.active ? "Retire this room" : "Bring this room back"}
                  onClick={() => {
                    const msg = r.active
                      ? `Retire "${r.name}"? It stops appearing for new bookings. Its ${r.bookingCount} existing booking(s) are kept.`
                      : `Bring "${r.name}" back for booking?`;
                    if (confirm(msg)) start(() => setRoomActive(r.id, !r.active));
                  }}
                >
                  {r.active ? (
                    <Archive className="h-3.5 w-3.5 text-slate-500" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5 text-brand-600" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {adding && (
        <Modal title="Add meeting room" open onOpenChange={setAdding}>
          <RoomForm onDone={() => setAdding(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.name}`} open onOpenChange={(o) => !o && setEditing(null)}>
          <RoomForm room={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}
