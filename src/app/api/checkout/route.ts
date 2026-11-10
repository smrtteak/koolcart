import { startCheckout } from "@/lib/commerce";
import { errorResponse } from "@/lib/http";

// Cart checkout or single "Buy now". A line may carry a haggled unitPrice with the conversationId of the shop chat
// that agreed it; startCheckout only honours it if that chat really made the deal.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      items?: { listingId: string; quantity: number; unitPrice?: number; conversationId?: string }[];
      listingId?: string;
      quantity?: number;
    };
    const items = body.items ?? (body.listingId ? [{ listingId: body.listingId, quantity: body.quantity ?? 1 }] : []);
    if (!items.length) throw new Error("Your cart is empty");
    const order = await startCheckout(
      items.map((i) => ({
        listingId: String(i.listingId),
        quantity: Number(i.quantity),
        unitPrice: typeof i.unitPrice === "number" ? i.unitPrice : undefined,
        conversationId: typeof i.conversationId === "string" ? i.conversationId : undefined,
      })),
    );
    return Response.json({ orderId: order.id, total: order.total });
  } catch (e) {
    return errorResponse(e);
  }
}
