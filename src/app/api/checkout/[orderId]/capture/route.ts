import { completeCheckout } from "@/lib/commerce";
import { errorResponse } from "@/lib/http";

export async function POST(_req: Request, ctx: RouteContext<"/api/checkout/[orderId]/capture">) {
  try {
    const { orderId } = await ctx.params;
    const order = await completeCheckout(orderId);
    return Response.json({ order });
  } catch (e) {
    return errorResponse(e);
  }
}
