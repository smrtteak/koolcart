// Business rules shared by the AI agents and the plain REST routes.
// Price floors and stock are enforced here, server-side, never by the model.
import * as koolupi from "./koolupi";
import * as paypal from "./paypal";
import { paymentProvider } from "./payments";
import { HOUSE_SELLER, mutate, read, sellerKey, sellerOf, type Listing, type Order } from "./store";

export type CartLine = { listingId: string; quantity: number; unitPrice?: number };

export async function startCheckout(lines: CartLine[]): Promise<Order> {
  const db = await read();
  const resolved = lines.map((line) => {
    const listing = db.listings.find((l) => l.id === line.listingId);
    if (!listing) throw new Error(`Unknown listing ${line.listingId}`);
    if (line.quantity < 1) throw new Error("Quantity must be at least 1");
    if (line.quantity > listing.stock) throw new Error(`Only ${listing.stock} of "${listing.title}" left`);
    const unitPrice = Math.round((line.unitPrice ?? listing.price) * 100) / 100;
    if (unitPrice < listing.floorPrice) {
      throw new Error(`Price ${unitPrice} for "${listing.title}" is below what the seller accepts`);
    }
    if (unitPrice > listing.price) throw new Error("Price cannot exceed the list price");
    return { listing, unitPrice, quantity: line.quantity };
  });

  // KoolUPI orders are created here and paid in the UPI sheet; PayPal orders are created on PayPal.
  const orderId =
    paymentProvider() === "paypal"
      ? (
          await paypal.createOrder(
            resolved.map((r) => ({ sku: r.listing.id, name: r.listing.title, unitPrice: r.unitPrice, quantity: r.quantity })),
            { description: `${db.shopName} order` },
          )
        ).id
      : koolupi.newOrderId();

  const order: Order = {
    id: orderId,
    lines: resolved.map((r) => ({
      listingId: r.listing.id,
      title: r.listing.title,
      unitPrice: r.unitPrice,
      quantity: r.quantity,
      sellerName: sellerOf(r.listing),
    })),
    total: resolved.reduce((s, r) => s + Math.round(r.unitPrice * 100) * r.quantity, 0) / 100,
    status: "CREATED",
    negotiated: resolved.some((r) => r.unitPrice < r.listing.price),
    createdAt: new Date().toISOString(),
  };
  await mutate((db) => {
    db.orders.push(order);
  });
  return order;
}

/** Records a successful payment on an order and takes the items out of stock. */
function markPaid(orderId: string, paid: Pick<Order, "captureId" | "payerName" | "payerEmail" | "payment">) {
  return mutate((db) => {
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "CREATED") return order;
    Object.assign(order, paid, { status: "COMPLETED", capturedAt: new Date().toISOString() });
    for (const line of order.lines) {
      const listing = db.listings.find((l) => l.id === line.listingId);
      if (listing) listing.stock = Math.max(0, listing.stock - line.quantity);
    }
    return order;
  });
}

/** PayPal: capture an order the buyer approved in PayPal's window. */
export async function completeCheckout(orderId: string): Promise<Order> {
  const captured = await paypal.captureOrder(orderId);
  const capture = captured.purchase_units[0]?.payments?.captures?.[0];
  return markPaid(orderId, {
    captureId: capture?.id,
    payerEmail: captured.payer?.email_address,
    payerName: [captured.payer?.name?.given_name, captured.payer?.name?.surname].filter(Boolean).join(" "),
    payment: { gateway: "paypal" },
  });
}

/** KoolUPI: pay an order with a 4-digit PIN (any digits; it's a model). */
export async function payWithUpi(orderId: string, pin: string, upiId?: string): Promise<{ order: Order }> {
  const db = await read();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status !== "CREATED") return { order };
  // Stock may have sold out since the order was opened.
  for (const line of order.lines) {
    const listing = db.listings.find((l) => l.id === line.listingId);
    if (!listing || listing.stock < line.quantity) throw new Error(`Sorry, "${line.title}" just sold out.`);
  }
  const payment = koolupi.pay(pin, upiId);
  const paid = await markPaid(orderId, {
    captureId: payment.paymentId,
    payerName: payment.upiId.split("@")[0],
    payment: { gateway: "koolupi", upiId: payment.upiId, utr: payment.utr },
  });
  return { order: paid };
}

export async function refundOrder(orderId: string, amount?: number, reason?: string) {
  const db = await read();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (!order.captureId) throw new Error("Order was never paid");
  const remaining = order.total - (order.refundedAmount ?? 0);
  if (amount !== undefined && amount > remaining + 0.001) {
    throw new Error(`Can refund at most ${remaining.toFixed(2)}`);
  }
  const refund =
    order.payment?.gateway === "koolupi" || order.captureId.startsWith("upi_")
      ? koolupi.refund(order.captureId)
      : await paypal.refundCapture(order.captureId, amount, reason);
  return mutate((db) => {
    const o = db.orders.find((x) => x.id === orderId)!;
    o.refundedAmount = Math.round(((o.refundedAmount ?? 0) + (amount ?? remaining)) * 100) / 100;
    o.status = o.refundedAmount >= o.total - 0.001 ? "REFUNDED" : "PARTIALLY_REFUNDED";
    return { refundId: refund.id, refundStatus: refund.status, order: o };
  });
}

// ---------- Multi-seller views ----------

export const ownsListing = (l: Listing, name: string) => sellerKey(sellerOf(l)) === sellerKey(name);

function lineSeller(line: Order["lines"][number], listings: Listing[]) {
  return line.sellerName ?? listings.find((l) => l.id === line.listingId)?.sellerName ?? HOUSE_SELLER;
}

/**
 * One seller's view of an order: only their lines, their share of the total, and what's been refunded of it.
 * Returns null when the order has nothing of theirs.
 */
export function sellerView(order: Order, listings: Listing[], name: string): Order | null {
  const key = sellerKey(name);
  const lines = order.lines.filter((l) => sellerKey(lineSeller(l, listings)) === key);
  if (!lines.length) return null;
  const share = Math.round(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) * 100) / 100;
  const allMine = lines.length === order.lines.length;
  const refunded = allMine ? (order.refundedAmount ?? 0) : (order.refundedBySeller?.[key] ?? 0);
  const status =
    order.status === "CREATED"
      ? "CREATED"
      : refunded >= share - 0.001
        ? "REFUNDED"
        : refunded > 0
          ? "PARTIALLY_REFUNDED"
          : "COMPLETED";
  return { ...order, lines, total: share, refundedAmount: refunded || undefined, status };
}

/** Refunds (part of) one seller's share of an order. Defaults to everything still refundable. */
export async function refundForSeller(orderId: string, name: string, amount?: number, reason?: string) {
  const db = await read();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  const view = sellerView(order, db.listings, name);
  if (!view) throw new Error("That order doesn't include any of your items");
  if (view.status === "CREATED") throw new Error("Order was never paid");
  const available = Math.round((view.total - (view.refundedAmount ?? 0)) * 100) / 100;
  if (available <= 0.001) throw new Error("Your part of this order is already refunded");
  const value = amount ?? available;
  if (value > available + 0.001) throw new Error(`You can refund at most $${available.toFixed(2)} on this order`);
  const result = await refundOrder(orderId, value, reason);
  await mutate((db) => {
    const o = db.orders.find((x) => x.id === orderId)!;
    const key = sellerKey(name);
    o.refundedBySeller = { ...o.refundedBySeller, [key]: Math.round(((o.refundedBySeller?.[key] ?? 0) + value) * 100) / 100 };
  });
  return { ...result, amount: value };
}
