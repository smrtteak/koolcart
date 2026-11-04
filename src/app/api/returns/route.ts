import { errorResponse } from "@/lib/http";
import { mutate, newId, read, RETURN_REASONS, type ReturnRequest } from "@/lib/store";

const RETURN_WINDOW_DAYS = 30;

// Buyer: open a return or exchange request for a paid order.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<ReturnRequest>;
    const orderId = String(body.orderId ?? "").trim();
    if (body.type !== "return" && body.type !== "exchange") throw new Error("Choose return or exchange");
    if (!RETURN_REASONS.includes(body.reason as ReturnRequest["reason"])) throw new Error("Pick a reason");

    const request = await mutate((db) => {
      const order = db.orders.find((o) => o.id === orderId);
      if (!order) throw new Error("We couldn't find that order number. It's on your PayPal receipt.");
      if (order.status !== "COMPLETED") throw new Error("That order isn't eligible — it was never paid or is already refunded.");
      const paidAt = new Date(order.capturedAt ?? order.createdAt).getTime();
      if (Date.now() - paidAt > RETURN_WINDOW_DAYS * 864e5) throw new Error(`Returns close ${RETURN_WINDOW_DAYS} days after purchase.`);
      if (db.returns.some((r) => r.orderId === orderId && r.status !== "DECLINED")) {
        throw new Error("There's already an open request for this order.");
      }
      const r: ReturnRequest = {
        id: `R-${newId().toUpperCase()}`,
        orderId,
        type: body.type!,
        reason: body.reason as ReturnRequest["reason"],
        details: body.details?.toString().slice(0, 500) || undefined,
        status: "REQUESTED",
        createdAt: new Date().toISOString(),
      };
      db.returns.push(r);
      return r;
    });
    return Response.json({ request });
  } catch (e) {
    return errorResponse(e);
  }
}

// Buyer: look up requests for an order number.
export async function GET(req: Request) {
  const orderId = new URL(req.url).searchParams.get("orderId")?.trim();
  if (!orderId) return Response.json({ requests: [] });
  const db = await read();
  return Response.json({ requests: db.returns.filter((r) => r.orderId === orderId) });
}
