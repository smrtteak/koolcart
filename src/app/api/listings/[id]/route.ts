import { ownsListing } from "@/lib/commerce";
import { errorResponse, sellerAuth } from "@/lib/http";
import { mutate } from "@/lib/store";

// Quick edits from the seller dashboard (stock +/-), and delete. Sellers can only touch their own listings.
export async function PATCH(req: Request, ctx: RouteContext<"/api/listings/[id]">) {
  const auth = sellerAuth(req);
  if ("denied" in auth) return auth.denied;
  try {
    const { id } = await ctx.params;
    const { stockDelta } = (await req.json()) as { stockDelta: number };
    const listing = await mutate((db) => {
      const l = db.listings.find((x) => x.id === id);
      if (!l || !ownsListing(l, auth.name)) throw new Error("Listing not found in your shop");
      l.stock = Math.max(0, l.stock + Math.trunc(stockDelta));
      return l;
    });
    return Response.json({ listing });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/listings/[id]">) {
  const auth = sellerAuth(req);
  if ("denied" in auth) return auth.denied;
  try {
    const { id } = await ctx.params;
    await mutate((db) => {
      const l = db.listings.find((x) => x.id === id);
      if (!l || !ownsListing(l, auth.name)) throw new Error("Listing not found in your shop");
      db.listings = db.listings.filter((x) => x.id !== id);
    });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
