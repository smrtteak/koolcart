import { runSellerAgent } from "@/lib/agents/seller";
import type { ChatTurn } from "@/lib/agents/run";
import { errorResponse, sellerAuth } from "@/lib/http";

export async function POST(req: Request) {
  const auth = sellerAuth(req);
  if ("denied" in auth) return auth.denied;
  try {
    const { history } = (await req.json()) as { history: ChatTurn[] };
    return Response.json(await runSellerAgent(history, auth.name));
  } catch (e) {
    return errorResponse(e);
  }
}
