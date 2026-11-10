import { errorResponse } from "@/lib/http";
import { read } from "@/lib/store";

// Buyer: look up orders by number (?ids=KC-…,KC-…). Unknown or unpaid numbers are left out.
export async function GET(req: Request) {
  try {
    const ids = new Set(
      (new URL(req.url).searchParams.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50),
    );
    const db = await read();
    const orders = db.orders
      .filter((o) => ids.has(o.id) && o.status !== "CREATED")
      .map((o) => {
        const request = db.returns.filter((r) => r.orderId === o.id).at(-1);
        return {
          id: o.id,
          lines: o.lines,
          total: o.total,
          status: o.status,
          negotiated: o.negotiated,
          refundedAmount: o.refundedAmount,
          payment: o.payment,
          createdAt: o.createdAt,
          capturedAt: o.capturedAt,
          request: request && { id: request.id, type: request.type, status: request.status },
        };
      })
      .sort((a, b) => (b.capturedAt ?? b.createdAt).localeCompare(a.capturedAt ?? a.createdAt));
    return Response.json({ orders });
  } catch (e) {
    return errorResponse(e);
  }
}
