import "server-only";
import { headers } from "next/headers";
import { db } from "@/db";
import { activityLog } from "@/db/schema";
import type { SessionUser } from "./auth";

type LogInput = {
  action: string; // e.g. "company.create"
  summary: string; // human-readable one-liner
  entityType?: string;
  entityId?: string | number;
  metadata?: Record<string, unknown>;
  // Provide when the actor is a signed-in user; omit for system/api events.
  actor?: SessionUser | null;
  actorType?: "user" | "system" | "api";
  actorLabel?: string;
};

async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    return h.get("x-real-ip");
  } catch {
    return null;
  }
}

/**
 * Records a single event in the activity log. Every mutation — from a user
 * action or an inbound API/webhook — should funnel through here.
 */
export async function logEvent(input: LogInput): Promise<void> {
  const {
    action,
    summary,
    entityType,
    entityId,
    metadata,
    actor,
    actorType,
    actorLabel,
  } = input;

  const resolvedType = actorType ?? (actor ? "user" : "system");
  const resolvedLabel =
    actorLabel ?? (actor ? actor.name : resolvedType === "api" ? "API" : "System");

  try {
    await db.insert(activityLog).values({
      actorType: resolvedType,
      actorId: actor?.id ?? null,
      actorLabel: resolvedLabel,
      action,
      entityType: entityType ?? null,
      entityId: entityId != null ? String(entityId) : null,
      summary,
      metadata: metadata ?? null,
      ip: await clientIp(),
    });
  } catch (err) {
    // Logging must never break the primary operation.
    console.error("[activity-log] failed to record event", action, err);
  }
}
