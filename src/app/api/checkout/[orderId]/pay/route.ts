import { payWithUpi } from "@/lib/commerce";
import { errorResponse } from "@/lib/http";

// KoolUPI: pay an order with a 4-digit PIN. It's a model: any digits work and the PIN is never stored.
export async function POST(req: Request, ctx: RouteContext<"/api/checkout/[orderId]/pay">) {
  try {
    const { orderId } = await ctx.params;
    const { pin, upiId } = (await req.json()) as { pin?: string; upiId?: string };
    return Response.json(await payWithUpi(orderId, String(pin ?? ""), upiId ? String(upiId) : undefined));
  } catch (e) {
    return errorResponse(e);
  }
}
