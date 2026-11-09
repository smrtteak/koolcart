import { ownsListing, sellerView } from "@/lib/commerce";
import { sellerAuth } from "@/lib/http";
import { read } from "@/lib/store";

// One seller's back room: only their listings, their part of each order, and returns on those orders.
export async function GET(req: Request) {
  const auth = sellerAuth(req);
  if ("denied" in auth) return auth.denied;
  const db = await read();
  const orders = db.orders
    .map((o) => sellerView(o, db.listings, auth.name))
    .filter((o) => o !== null)
    .reverse();
  const orderIds = new Set(orders.map((o) => o.id));
  return Response.json({
    shopName: db.shopName,
    sellerName: auth.name,
    listings: db.listings.filter((l) => ownsListing(l, auth.name)),
    orders,
    returns: db.returns.filter((r) => orderIds.has(r.orderId)),
  });
}
