import { runBuyerAgent } from "@/lib/agents/buyer";
import type { ChatTurn } from "@/lib/agents/run";
import { errorResponse } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const { history } = (await req.json()) as { history: ChatTurn[] };
    // Buyers can't upload images; drop anything sent anyway.
    const clean = history.map(({ role, text }) => ({ role, text: String(text).slice(0, 2000) }));
    return Response.json(await runBuyerAgent(clean));
  } catch (e) {
    return errorResponse(e);
  }
}
