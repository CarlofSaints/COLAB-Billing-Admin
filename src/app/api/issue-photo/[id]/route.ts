import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { issues } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

/**
 * Serves the photo attached to an issue, from the PRIVATE Blob store.
 *
 * Signed-in only. The public sticker page can write photos here without any
 * login, so the read side has to be the gate — an unauthenticated write path
 * with an unauthenticated read path would be an open image host.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const issueId = Number(id);
  if (!Number.isInteger(issueId)) return new Response("Bad request", { status: 400 });

  const [row] = await db
    .select({ photoPath: issues.photoPath, contentType: issues.photoContentType })
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1);
  if (!row?.photoPath) return new Response("Not found", { status: 404 });

  const res = await get(row.photoPath, { access: "private" });
  if (!res || res.statusCode !== 200) return new Response("Not found", { status: 404 });

  return new Response(res.stream, {
    headers: {
      "Content-Type": row.contentType || res.blob.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    },
  });
}
