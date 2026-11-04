import { refundOrder } from "@/lib/commerce";
import { errorResponse } from "@/lib/http";
import { mutate, read } from "@/lib/store";

// Seller: approve or decline a request. Approving a return refunds the order through PayPal.
export async function PATCH(req: Request, ctx: RouteContext<"/api/returns/[id]">) {
  try {
    const { id } = await ctx.params;
    const { action } = (await req.json()) as { action: "approve" | "decline" };
    const r = (await read()).returns.find((x) => x.id === id);
    if (!r) throw new Error("Request not found");
    if (r.status !== "REQUESTED") throw new Error("Already resolved");

    let refundId: string | undefined;
    if (action === "approve" && r.type === "return") {
      refundId = (await refundOrder(r.orderId, undefined, `Return approved: ${r.reason}`)).refundId;
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
