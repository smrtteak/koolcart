import { refundOrder } from "@/lib/commerce";
import { errorResponse, sellerGuard } from "@/lib/http";

// One-click full refund from the seller dashboard.
export async function POST(req: Request, ctx: RouteContext<"/api/orders/[orderId]/refund">) {
  const denied = sellerGuard(req);
  if (denied) return denied;
  try {
    const { orderId } = await ctx.params;
    return Response.json(await refundOrder(orderId, undefined, "Refunded by the seller"));
  } catch (e) {
    return errorResponse(e);
  }
}
