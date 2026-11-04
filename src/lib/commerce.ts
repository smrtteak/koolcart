// Business rules shared by the AI agents and the plain REST routes.
// Price floors and stock are enforced here, server-side, never by the model.
import * as paypal from "./paypal";
import { mutate, read, type Order } from "./store";

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

  const ppOrder = await paypal.createOrder(
    resolved.map((r) => ({
      sku: r.listing.id,
      name: r.listing.title,
      unitPrice: r.unitPrice,
      quantity: r.quantity,
    })),
    { description: `${db.shopName} order` },
  );

  const order: Order = {
    id: ppOrder.id,
    lines: resolved.map((r) => ({
      listingId: r.listing.id,
      title: r.listing.title,
      unitPrice: r.unitPrice,
      quantity: r.quantity,
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

export async function completeCheckout(orderId: string): Promise<Order> {
  const captured = await paypal.captureOrder(orderId);
  const capture = captured.purchase_units[0]?.payments?.captures?.[0];
  return mutate((db) => {
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order not found");
    if (order.status !== "CREATED") return order;
    order.status = "COMPLETED";
    order.captureId = capture?.id;
    order.capturedAt = new Date().toISOString();
    order.payerEmail = captured.payer?.email_address;
    order.payerName = [captured.payer?.name?.given_name, captured.payer?.name?.surname].filter(Boolean).join(" ");
    for (const line of order.lines) {
      const listing = db.listings.find((l) => l.id === line.listingId);
      if (listing) listing.stock = Math.max(0, listing.stock - line.quantity);
    }
    return order;
  });
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
  const refund = await paypal.refundCapture(order.captureId, amount, reason);
  return mutate((db) => {
    const o = db.orders.find((x) => x.id === orderId)!;
    o.refundedAmount = Math.round(((o.refundedAmount ?? 0) + (amount ?? remaining)) * 100) / 100;
    o.status = o.refundedAmount >= o.total - 0.001 ? "REFUNDED" : "PARTIALLY_REFUNDED";
    return { refundId: refund.id, refundStatus: refund.status, order: o };
  });
}
