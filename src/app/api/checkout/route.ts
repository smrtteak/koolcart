import { startCheckout } from "@/lib/commerce";
import { errorResponse } from "@/lib/http";

// Cart checkout or single "Buy now", always at list price (haggled prices go through the assistant).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      items?: { listingId: string; quantity: number }[];
      listingId?: string;
      quantity?: number;
    };
    const items = body.items ?? (body.listingId ? [{ listingId: body.listingId, quantity: body.quantity ?? 1 }] : []);
    if (!items.length) throw new Error("Your cart is empty");
    const order = await startCheckout(items.map((i) => ({ listingId: i.listingId, quantity: i.quantity })));
    return Response.json({ orderId: order.id, total: order.total });
  } catch (e) {
    return errorResponse(e);
  }
}
