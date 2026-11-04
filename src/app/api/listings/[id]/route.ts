import { errorResponse, sellerGuard } from "@/lib/http";
import { mutate } from "@/lib/store";

// Quick edits from the seller dashboard (stock +/-), and delete.
export async function PATCH(req: Request, ctx: RouteContext<"/api/listings/[id]">) {
  const denied = sellerGuard(req);
  if (denied) return denied;
  try {
    const { id } = await ctx.params;
    const { stockDelta } = (await req.json()) as { stockDelta: number };
    const listing = await mutate((db) => {
      const l = db.listings.find((x) => x.id === id);
      if (!l) throw new Error("Listing not found");
      l.stock = Math.max(0, l.stock + Math.trunc(stockDelta));
      return l;
    });
    return Response.json({ listing });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/listings/[id]">) {
  const denied = sellerGuard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  await mutate((db) => {
    db.listings = db.listings.filter((l) => l.id !== id);
  });
  return Response.json({ ok: true });
}
