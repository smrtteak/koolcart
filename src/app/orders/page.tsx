"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { forgetOrder, myOrderIds, rememberOrder } from "@/lib/my-orders";

type Order = {
  id: string;
  lines: { listingId: string; title: string; unitPrice: number; quantity: number; sellerName?: string }[];
  total: number;
  status: "COMPLETED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  negotiated: boolean;
  refundedAmount?: number;
  payment?: { gateway: "koolupi" | "paypal"; upiId?: string; utr?: string };
  createdAt: string;
  capturedAt?: string;
  request?: { id: string; type: "return" | "exchange"; status: "REQUESTED" | "APPROVED" | "DECLINED" };
};

const usd = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

const STATUS: Record<Order["status"], [string, string]> = {
  COMPLETED: ["paid", "bg-tint-green"],
  PARTIALLY_REFUNDED: ["partly refunded", "bg-tint-amber"],
  REFUNDED: ["refunded", "bg-tint-rose"],
};

const REQUEST: Record<NonNullable<Order["request"]>["status"], string> = {
  REQUESTED: "waiting on the shop",
  APPROVED: "approved",
  DECLINED: "declined",
};

async function fetchOrders(ids: string[]): Promise<Order[]> {
  if (!ids.length) return [];
  const res = await fetch(`/api/orders?ids=${encodeURIComponent(ids.join(","))}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Couldn't load your orders");
  return data.orders;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>();
  const [error, setError] = useState("");
  const [find, setFind] = useState("");
  const [finding, setFinding] = useState(false);

  useEffect(() => {
    fetchOrders(myOrderIds())
      .then(setOrders)
      .catch((e: Error) => {
        setError(e.message);
        setOrders([]);
      });
  }, []);

  async function lookUp(e: React.FormEvent) {
    e.preventDefault();
    const id = find.trim().toUpperCase();
    if (!id) return;
    setError("");
    setFinding(true);
    try {
      const [order] = await fetchOrders([id]);
      if (!order) throw new Error("We couldn't find a paid order with that number.");
      rememberOrder(order.id);
      setOrders((list = []) => [order, ...list.filter((o) => o.id !== order.id)]);
      setFind("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFinding(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="font-hand text-2xl text-brand">everything you&apos;ve picked up</div>
      <h1 className="font-display text-5xl leading-none sm:text-6xl">Your orders</h1>
      <p className="mt-3 max-w-lg text-muted">
        Orders you pay for in this browser show up here. Bought on another device? Type its order number from the
        receipt to add it.
      </p>

      <form onSubmit={lookUp} className="mt-6 flex gap-2">
        <input
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Order number, e.g. KC-4A97BFDA2A"
          aria-label="Order number"
          className="min-w-0 flex-1 rounded-xl border border-line-strong bg-background/50 px-4 py-2.5 font-mono text-sm outline-none focus:bg-paper"
        />
        <button disabled={finding} className="btn-line shrink-0 rounded-xl px-4 text-sm disabled:opacity-50">
          {finding ? "Looking…" : "Find order"}
        </button>
      </form>
      {error && <div className="mt-2 text-sm text-warn">{error}</div>}

      <div className="mt-8 space-y-4">
        {!orders ? (
          [0, 1].map((i) => <div key={i} className="card h-36 animate-pulse rounded-[24px]" />)
        ) : orders.length === 0 ? (
          <div className="card rounded-[24px] p-8 text-center">
            <div className="font-hand text-3xl">nothing here yet</div>
            <p className="mt-2 text-muted">When you buy something, it&apos;ll be waiting for you here.</p>
            <Link href="/" className="btn-ink mt-5 inline-block rounded-full px-5 py-2.5 text-sm font-semibold">
              Go shopping
            </Link>
          </div>
        ) : (
          orders.map((o) => {
            const [label, tint] = STATUS[o.status];
            return (
              <article key={o.id} className="card rounded-[24px] p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm">{o.id}</div>
                    <div className="text-xs text-muted">{when(o.capturedAt ?? o.createdAt)}</div>
                  </div>
                  <span className={`sticker rounded-full px-3 font-hand text-base ${tint}`}>{label}</span>
                </div>

                <ul className="mt-4 divide-y divide-line border-y border-line">
                  {o.lines.map((l) => (
                    <li key={l.listingId} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                      <span>
                        {l.title}
                        {l.quantity > 1 && <span className="text-muted"> × {l.quantity}</span>}
                        {l.sellerName && <span className="text-xs text-muted"> · by {l.sellerName}</span>}
                      </span>
                      <span className="tabular-nums">{usd(l.unitPrice * l.quantity)}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-xs text-muted">
                    {o.payment?.gateway === "koolupi"
                      ? `KoolUPI · ${o.payment.upiId} · UTR ${o.payment.utr}`
                      : o.payment?.gateway === "paypal"
                        ? "Paid with PayPal"
                        : null}
                    {o.negotiated && <span className="font-hand text-sm text-brand"> · haggled price</span>}
                  </div>
                  <div className="font-display text-2xl tabular-nums">{usd(o.total)}</div>
                </div>
                {!!o.refundedAmount && (
                  <div className="mt-1 text-right text-xs text-muted">{usd(o.refundedAmount)} refunded</div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {o.request ? (
                    <span className="text-sm text-muted">
                      {o.request.type === "return" ? "Return" : "Exchange"} {o.request.id}: {REQUEST[o.request.status]}
                    </span>
                  ) : (
                    o.status === "COMPLETED" && (
                      <Link href={`/returns?order=${o.id}`} className="btn-line rounded-full px-4 py-2 text-sm">
                        Return or exchange
                      </Link>
                    )
                  )}
                  <button
                    onClick={() => {
                      forgetOrder(o.id);
                      setOrders((list = []) => list.filter((x) => x.id !== o.id));
                    }}
                    className="ml-auto text-xs text-muted hover:text-ink"
                  >
                    Hide from this list
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
