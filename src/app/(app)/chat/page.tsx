import { requirePermission } from "@/lib/auth";
import { getSummary, chatUsers } from "@/lib/chat";
import { ChatClient } from "./chat-client";

export const metadata = { title: "Chat — COLAB" };
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requirePermission("hub.view");
  const me = { id: user.id, email: user.email };

  const [summary, people] = await Promise.all([getSummary(me), chatUsers(user.id)]);

  return <ChatClient initialSummary={summary} people={people} />;
}
