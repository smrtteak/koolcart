import { refundOrder } from "@/lib/commerce";
import { errorResponse } from "@/lib/http";

// One-click full refund from the seller dashboard.
export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[orderId]/refund">) {
  try {
    const { orderId } = await ctx.params;
    return Response.json(await refundOrder(orderId, undefined, "Refunded by the seller"));
  } catch (e) {
    return errorResponse(e);
  }
}
