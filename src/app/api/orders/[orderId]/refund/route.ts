import { refundForSeller } from "@/lib/commerce";
import { errorResponse, sellerAuth } from "@/lib/http";

// One-click refund from the seller dashboard: refunds this seller's share of the order through PayPal.
export async function POST(req: Request, ctx: RouteContext<"/api/orders/[orderId]/refund">) {
  const auth = sellerAuth(req);
  if ("denied" in auth) return auth.denied;
  try {
    const { orderId } = await ctx.params;
    return Response.json(await refundForSeller(orderId, auth.name, undefined, "Refunded by the seller"));
  } catch (e) {
    return errorResponse(e);
  }
}
