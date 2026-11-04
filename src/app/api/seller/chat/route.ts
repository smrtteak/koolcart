import { runSellerAgent } from "@/lib/agents/seller";
import type { ChatTurn } from "@/lib/agents/run";
import { errorResponse } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const { history } = (await req.json()) as { history: ChatTurn[] };
    return Response.json(await runSellerAgent(history));
  } catch (e) {
    return errorResponse(e);
  }
}
