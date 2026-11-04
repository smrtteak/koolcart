import { z } from "zod";
import * as paypal from "../paypal";
import { refundOrder } from "../commerce";
import { mutate, newId, read, type Listing } from "../store";
import { runAgent, tool, type ChatTurn } from "./run";

const SYSTEM = `You are the back-office assistant for a small online shop that takes payments through PayPal.
The seller talks to you in plain language; you run the shop for them with your tools.

What you do:
- Turn a rough description (and photo, if attached) into a polished listing: a clear title, a one-line tagline, a
  2–4 sentence description that sells without exaggerating, a category, a few search tags, a price and a stock count.
- Every listing also needs a floor price: the lowest price the shop's buyer-facing AI may agree to when a customer
  haggles. If the seller doesn't give one, propose ~85% of the list price and say so.
- If the seller gives no price, suggest a realistic one for the item and its condition and say why in one line.
- Answer questions about sales and orders using the tools, never from memory.
- Issue refunds through PayPal when asked. Confirm the order and amount in your reply.

Keep replies short: a few lines, plain text, no markdown headings. Prices are in USD.`;

export async function runSellerAgent(history: ChatTurn[]) {
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
  };

  const tools = [
    tool({
      name: "get_shop_overview",
      description: "Get the shop name, every listing (including floor prices and stock) and a sales summary.",
      schema: z.object({}),
      run: async () => {
        const db = await read();
        const paid = db.orders.filter((o) => o.status !== "CREATED");
        const revenue = paid.reduce((s, o) => s + o.total - (o.refundedAmount ?? 0), 0);
        return JSON.stringify({
          shopName: db.shopName,
          listings: db.listings.map(({ image: _i, ...l }) => (void _i, l)),
          sales: {
            paidOrders: paid.length,
            netRevenueUSD: Math.round(revenue * 100) / 100,
            negotiatedOrders: paid.filter((o) => o.negotiated).length,
            abandonedCheckouts: db.orders.filter((o) => o.status === "CREATED").length,
          },
        });
      },
    }),
    tool({
      name: "create_listing",
      description:
        "Publish a new product listing. Also registers it in the PayPal product catalog. The photo the seller attached in this conversation, if any, is used automatically.",
      schema: z.object(listingFields),
      run: async (input) => {
        if (input.floorPrice > input.price) return "Error: floorPrice must not exceed price.";
        let paypalProductId: string | undefined;
        let catalogNote = "";
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
        const listing: Listing = {
          id: newId(),
          ...input,
          image: latestImage,
          paypalProductId,
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
          if (!l) return null;
          Object.assign(l, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
          if (l.floorPrice > l.price) l.floorPrice = l.price;
          return l;
        });
        if (!updated) return `Error: no listing ${id}`;
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
          db.listings = db.listings.filter((l) => l.id !== id);
          return db.listings.length < before;
        });
        return ok ? `Removed ${id}.` : `Error: no listing ${id}`;
      },
    }),
    tool({
      name: "list_orders",
      description: "List recent orders, newest first, with status, buyer, lines and PayPal ids.",
      schema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
      run: async ({ limit }) => {
        const db = await read();
        return JSON.stringify(db.orders.slice().reverse().slice(0, limit ?? 15));
      },
    }),
    tool({
      name: "refund_order",
      description: "Refund a paid order through PayPal. Omit amount for a full refund.",
      schema: z.object({
        orderId: z.string().describe("PayPal order id"),
        amount: z.number().positive().optional(),
        reason: z.string().max(200).optional().describe("Short note shown to the buyer"),
      }),
      run: async ({ orderId, amount, reason }) => {
        try {
          const r = await refundOrder(orderId, amount, reason);
          return `Refund ${r.refundId} ${r.refundStatus}. Order is now ${r.order.status}, refunded $${r.order.refundedAmount?.toFixed(2)}.`;
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      },
    }),
    tool({
      name: "set_shop_name",
      description: "Rename the shop.",
      schema: z.object({ name: z.string().min(1).max(60) }),
      run: async ({ name }) => {
        await mutate((db) => {
          db.shopName = name;
        });
        return `Shop renamed to ${name}.`;
      },
    }),
  ];

  const { text, steps } = await runAgent({ system: SYSTEM, tools, history });
  return { reply: text, steps, listingIds: [...touched] };
}
