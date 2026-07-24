"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { CalendarPlus, MapPin, Pencil, Trash2, TriangleAlert } from "lucide-react";
import {
  createEvent,
  updateEvent,
  deleteEvent,
  type EventState,
} from "@/app/actions/events";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Field } from "@/components/ui/field";

type EventRow = {
  id: number;
  title: string;
  description: string | null;
  eventDate: string;
  location: string | null;
};

function formatDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : editing ? "Save changes" : "Add event"}
    </Button>
  );
}

function EventForm({ event, onDone }: { event?: EventRow; onDone: () => void }) {
  const editing = !!event;
  const [state, action] = useActionState<EventState, FormData>(
    editing ? updateEvent : createEvent,
    {},
  );

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="space-y-4">
      {editing && <input type="hidden" name="id" value={event.id} />}
      <Field label="Event name">
        <Input name="title" defaultValue={event?.title ?? ""} required autoFocus />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date">
          <Input name="eventDate" type="date" defaultValue={event?.eventDate ?? ""} required />
        </Field>
        <Field label="Location" hint="Optional.">
          <Input name="location" defaultValue={event?.location ?? ""} placeholder="Boardroom" />
        </Field>
      </div>
      <Field label="Details" hint="Optional — what it's about, what to bring, etc.">
        <Textarea name="description" defaultValue={event?.description ?? ""} rows={3} />
      </Field>

      {state.error && (
        <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <TriangleAlert className="h-4 w-4" /> {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton editing={editing} />
      </div>
    </form>
  );
}

function DeleteButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      title="Remove event"
      disabled={pending}
      onClick={() => {
        if (confirm("Remove this event?")) start(() => deleteEvent(id));
      }}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function EditButton({ event }: { event: EventRow }) {
  const [open, setOpen] = useState(false);
  return (
    <Modal
      title="Edit event"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm" title="Edit event">
          <Pencil className="h-4 w-4" />
        </Button>
      }
    >
      <EventForm event={event} onDone={() => setOpen(false)} />
    </Modal>
  );
}

export function EventsManager({
  events,
  canManage,
}: {
  events: EventRow[];
  canManage: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Modal
            title="Add event"
            open={addOpen}
            onOpenChange={setAddOpen}
            trigger={
              <Button size="sm" variant="outline">
                <CalendarPlus className="h-4 w-4" /> Add event
              </Button>
            }
          >
            <EventForm onDone={() => setAddOpen(false)} />
          </Modal>
        </div>
      )}

      {events.length === 0 ? (
        <p className="text-sm text-muted">No upcoming events yet. Add the first one.</p>
      ) : (
        <ul className="divide-y divide-line">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-4 py-3 first:pt-0">
              <div className="w-24 shrink-0 text-sm font-medium text-brand-700">
                {formatDate(e.eventDate)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{e.title}</p>
                {e.location && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted">
                    <MapPin className="h-3 w-3" /> {e.location}
                  </p>
                )}
                {e.description && (
                  <p className="mt-1 text-sm text-slate-600">{e.description}</p>
                )}
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center">
                  <EditButton event={e} />
                  <DeleteButton id={e.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
