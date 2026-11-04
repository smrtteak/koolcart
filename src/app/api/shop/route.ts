import { publicListing, read } from "@/lib/store";

export async function GET() {
  const db = await read();
  // Anonymised recent sales for the storefront's live ticker.
  const recent = db.orders
    .filter((o) => o.status !== "CREATED")
    .slice(-8)
    .reverse()
    .map((o) => ({
      title: o.lines[0]?.title ?? "an item",
      total: o.total,
      negotiated: o.negotiated,
      at: o.capturedAt ?? o.createdAt,
    }));
  return Response.json({ shopName: db.shopName, listings: db.listings.map(publicListing), recent, now: Date.now() });
}
