import { refundForSeller, sellerView } from "@/lib/commerce";
import { errorResponse, sellerAuth } from "@/lib/http";
import { mutate, read } from "@/lib/store";

// Seller: approve or decline a request on an order with their items. Approving a return refunds their share via PayPal.
export async function PATCH(req: Request, ctx: RouteContext<"/api/returns/[id]">) {
  const auth = sellerAuth(req);
  if ("denied" in auth) return auth.denied;
  try {
    const { id } = await ctx.params;
    const { action } = (await req.json()) as { action: "approve" | "decline" };
    const db = await read();
    const r = db.returns.find((x) => x.id === id);
    const order = r && db.orders.find((o) => o.id === r.orderId);
    if (!r || !order || !sellerView(order, db.listings, auth.name)) throw new Error("Request not found");
    if (r.status !== "REQUESTED") throw new Error("Already resolved");

    let refundId: string | undefined;
    if (action === "approve" && r.type === "return") {
      refundId = (await refundForSeller(r.orderId, auth.name, undefined, `Return approved: ${r.reason}`)).refundId;
    }
    const updated = await mutate((db) => {
      const x = db.returns.find((y) => y.id === id)!;
      x.status = action === "approve" ? "APPROVED" : "DECLINED";
      x.refundId = refundId;
      x.resolvedAt = new Date().toISOString();
      return x;
    });
    return Response.json({ request: updated });
  } catch (e) {
    return errorResponse(e);
  }
}
