import { runBuyerAgent } from "@/lib/agents/buyer";
import type { ChatTurn } from "@/lib/agents/run";
import { errorResponse } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const { history, conversationId } = (await req.json()) as { history: ChatTurn[]; conversationId?: string };
    // Buyers can't upload images; drop anything sent anyway.
    const clean = history.map(({ role, text }) => ({ role, text: String(text).slice(0, 2000) }));
    // One id per shopper's chat; haggling rounds and agreed prices are tracked against it.
    const chatId = typeof conversationId === "string" && /^[\w-]{8,64}$/.test(conversationId) ? conversationId : "anonymous";
    return Response.json(await runBuyerAgent(clean, chatId));
  } catch (e) {
    return errorResponse(e);
  }
}
