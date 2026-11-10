import { z } from "zod";
import * as paypal from "../paypal";
import { paymentProvider } from "../payments";
import { ownsListing, refundForSeller, sellerView } from "../commerce";
import { HAGGLE_STYLES, HAGGLE_STYLE_INFO } from "../haggle";
import { mutate, newId, read, type Listing } from "../store";
import { runAgent, tool, type ChatTurn } from "./run";

const system = (sellerName: string) => `You are the back-office assistant for Koolcart, a shared online marketplace. Many independent sellers list here. You are helping ${sellerName}; every tool only sees and
changes ${sellerName}'s own listings and orders, never other sellers'.
The seller talks to you in plain language; you run their shelf for them with your tools.

What you do:
- Turn a rough description (and photo, if attached) into a polished listing: a clear title, a one-line tagline, a
  2–4 sentence description that sells without exaggerating, a category, a few search tags, a price and a stock count.
- Every listing also needs a floor price: the lowest price the shop's buyer-facing AI may agree to when a customer
  haggles. If the seller doesn't give one, propose ~85% of the list price and say so.
- If the seller gives no price, suggest a realistic one for the item and its condition and say why in one line.
- Answer questions about sales and orders using the tools, never from memory.
- Issue refunds when asked. Confirm the order and amount in your reply.
- Each listing has a haggling style: firm (holds near the tag, never reaches the floor), fair (the default: concedes
  a bit each round, and a buyer's 3rd offer can reach the floor) or flexible (accepts any offer at or above the floor
  right away). Set it when the seller asks, e.g. "make the scarf flexible", or suggests it ("clear these out").

Keep replies short: a few lines, plain text, no markdown headings. Prices are in USD.`;

export async function runSellerAgent(history: ChatTurn[], sellerName: string) {
  // Listings created or edited this turn, shown as preview cards in the chat.
  const touched = new Set<string>();
  const latestImage = [...history].reverse().find((t) => t.role === "user")?.image;

  const listingFields = {
    title: z.string().max(100),
    tagline: z.string().max(140),
    description: z.string().max(1200),
    price: z.number().positive(),
    floorPrice: z.number().positive().describe("Lowest acceptable price when buyers haggle"),
    stock: z.number().int().min(0),
    category: z.string(),
    tags: z.array(z.string()).max(8),
    haggleStyle: z
      .enum(HAGGLE_STYLES)
      .optional()
      .describe(
        `How hard the shop AI haggles on this item. ${HAGGLE_STYLES.map((s) => `${s}: ${HAGGLE_STYLE_INFO[s]}`).join(" ")} Default fair.`,
      ),
  };

  const tools = [
    tool({
      name: "get_shop_overview",
      description: "Get this seller's listings (including floor prices and stock) and a summary of their sales.",
      schema: z.object({}),
      run: async () => {
        const db = await read();
        const orders = db.orders.map((o) => sellerView(o, db.listings, sellerName)).filter((o) => o !== null);
        const paid = orders.filter((o) => o.status !== "CREATED");
        const revenue = paid.reduce((s, o) => s + o.total - (o.refundedAmount ?? 0), 0);
        return JSON.stringify({
          seller: sellerName,
          listings: db.listings.filter((l) => ownsListing(l, sellerName)).map(({ image: _i, ...l }) => (void _i, l)),
          sales: {
            paidOrders: paid.length,
            netRevenueUSD: Math.round(revenue * 100) / 100,
            negotiatedOrders: paid.filter((o) => o.negotiated).length,
            abandonedCheckouts: orders.filter((o) => o.status === "CREATED").length,
          },
        });
      },
    }),
    tool({
      name: "create_listing",
      description:
        "Publish a new product listing. The photo the seller attached in this conversation, if any, is used automatically.",
      schema: z.object(listingFields),
      run: async (input) => {
        if (input.floorPrice > input.price) return "Error: floorPrice must not exceed price.";
        let paypalProductId: string | undefined;
        let catalogNote = "";
        // Only PayPal has a product catalog to sync to; KoolUPI takes payments without one.
        if (paymentProvider() === "paypal") {
          try {
            const product = await paypal.createCatalogProduct({
              name: input.title,
              description: input.tagline,
              imageUrl: latestImage,
            });
            paypalProductId = product.id;
          } catch (e) {
            catalogNote = ` (PayPal catalog sync failed: ${(e as Error).message})`;
          }
        }
        const listing: Listing = {
          id: newId(),
          ...input,
          image: latestImage,
          paypalProductId,
          sellerName,
          createdAt: new Date().toISOString(),
        };
        await mutate((db) => {
          db.listings.push(listing);
        });
        touched.add(listing.id);
        return `Created listing ${listing.id}${paypalProductId ? ` (PayPal product ${paypalProductId})` : ""}${catalogNote}.`;
      },
    }),
    tool({
      name: "update_listing",
      description: "Change fields on an existing listing. Only pass the fields that change.",
      schema: z.object({ id: z.string(), ...z.object(listingFields).partial().shape }),
      run: async ({ id, ...patch }) => {
        const updated = await mutate((db) => {
          const l = db.listings.find((x) => x.id === id);
          if (!l || !ownsListing(l, sellerName)) return null;
          Object.assign(l, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
          if (l.floorPrice > l.price) l.floorPrice = l.price;
          return l;
        });
        if (!updated) return `Error: no listing ${id} in ${sellerName}'s shop`;
        touched.add(id);
        if (updated.paypalProductId && patch.tagline) {
          await paypal.updateCatalogProduct(updated.paypalProductId, { description: patch.tagline }).catch(() => {});
        }
        return `Updated ${id}.`;
      },
    }),
    tool({
      name: "delete_listing",
      description: "Remove a listing from the storefront.",
      schema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        const ok = await mutate((db) => {
          const before = db.listings.length;
          db.listings = db.listings.filter((l) => l.id !== id || !ownsListing(l, sellerName));
          return db.listings.length < before;
        });
        return ok ? `Removed ${id}.` : `Error: no listing ${id} in ${sellerName}'s shop`;
      },
    }),
    tool({
      name: "list_orders",
      description: "List this seller's recent orders, newest first: their items in each order, status, buyer and payment ids.",
      schema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
      run: async ({ limit }) => {
        const db = await read();
        const mine = db.orders.map((o) => sellerView(o, db.listings, sellerName)).filter((o) => o !== null);
        return JSON.stringify(mine.reverse().slice(0, limit ?? 15));
      },
    }),
    tool({
      name: "refund_order",
      description: "Refund this seller's part of a paid order to the buyer. Omit amount to refund all of it.",
      schema: z.object({
        orderId: z.string().describe("Order id"),
        amount: z.number().positive().optional(),
        reason: z.string().max(200).optional().describe("Short note shown to the buyer"),
      }),
      run: async ({ orderId, amount, reason }) => {
        try {
          const r = await refundForSeller(orderId, sellerName, amount, reason);
          return `Refund ${r.refundId} ${r.refundStatus}: $${r.amount.toFixed(2)} returned to the buyer.`;
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    }),
  ];

  const { text, steps } = await runAgent({ system: system(sellerName), tools, history });
  return { reply: text, steps, listingIds: [...touched] };
}
