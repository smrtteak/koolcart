"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { celebrate } from "./celebrate";
import { PayPalCheckout } from "./PayPalCheckout";

export type CartItem = { id: string; title: string; price: number; image?: string; qty: number; stock: number };

type CartApi = {
  items: CartItem[];
  count: number;
  subtotal: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  add: (item: Omit<CartItem, "qty">, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartApi | null>(null);
const KEY = "koolcart.cart";

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // The cart is a per-browser convenience; storage can be unavailable (private mode), so never depend on it.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Array.isArray(saved)) setItems(saved);
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {}
  }, [items, loaded]);

  const api: CartApi = {
    items,
    count: items.reduce((s, i) => s + i.qty, 0),
    subtotal: items.reduce((s, i) => s + i.price * i.qty, 0),
    open,
    setOpen,
    add: (item, qty = 1) => {
      setItems((prev) => {
        const existing = prev.find((i) => i.id === item.id);
        if (existing) {
          return prev.map((i) => (i.id === item.id ? { ...i, ...item, qty: Math.min(item.stock, i.qty + qty) } : i));
        }
        return [...prev, { ...item, qty: Math.min(item.stock, qty) }];
      });
      setOpen(true);
    },
    setQty: (id, qty) =>
      setItems((prev) =>
        qty <= 0 ? prev.filter((i) => i.id !== id) : prev.map((i) => (i.id === id ? { ...i, qty: Math.min(i.stock, qty) } : i)),
      ),
    clear: () => setItems([]),
  };

  return (
    <CartContext.Provider value={api}>
      {children}
      <CartDrawer />
    </CartContext.Provider>
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

export function CartButton() {
  const { count, setOpen } = useCart();
  return (
    <button
      onClick={() => setOpen(true)}
      className="card press relative flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium"
      aria-label={`Cart, ${count} items`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2" />
        <circle cx="10" cy="20.5" r="1.2" />
        <circle cx="17" cy="20.5" r="1.2" />
      </svg>
      <span className="hidden sm:inline">Cart</span>
      {count > 0 && (
        <span
          key={count}
          className="absolute -right-2 -top-2 flex h-6 min-w-6 animate-[wiggle_.4s_ease-in-out] items-center justify-center rounded-full border-[1.5px] border-ink bg-accent px-1 text-xs font-bold"
        >
          {count}
        </span>
      )}
    </button>
  );
}

function CartDrawer() {
  const { items, subtotal, open, setOpen, setQty, clear } = useCart();
  const [paidOrder, setPaidOrder] = useState<{ id: string; total: number }>();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30 animate-[fadeIn_.15s_ease-out]" onClick={() => setOpen(false)}>
      <aside
        className="flex h-full w-full max-w-md animate-[slideIn_.25s_cubic-bezier(.2,.8,.2,1)] flex-col border-l-[1.5px] border-ink bg-paper"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-[1.5px] border-ink px-5 py-4">
          <div>
            <div className="font-display text-3xl leading-none">Your cart</div>
            <div className="font-hand text-lg text-muted">
              {items.length ? "almost yours…" : paidOrder ? "all paid up!" : "nothing here yet"}
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="btn-line h-9 w-9 rounded-full" aria-label="Close cart">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {paidOrder && !items.length && (
            <div className="card rounded-2xl p-5 text-center">
              <div className="font-display text-3xl">Thank you!</div>
              <p className="mt-1 text-sm text-muted">
                Paid {usd(paidOrder.total)} with PayPal. Order <span className="font-mono">{paidOrder.id}</span>
              </p>
              <Link
                href={`/returns?order=${paidOrder.id}`}
                onClick={() => setOpen(false)}
                className="mt-3 inline-block text-xs text-muted underline decoration-dotted underline-offset-4"
              >
                Need to return or swap something?
              </Link>
            </div>
          )}
          {!items.length && !paidOrder && (
            <p className="pt-10 text-center text-sm text-muted">
              Add something from the shop, or ask the shopkeeper for ideas.
            </p>
          )}
          {items.map((i) => (
            <div key={i.id} className="flex gap-3 rounded-2xl border border-line bg-background/60 p-3">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-paper font-display text-2xl italic text-muted">
                {i.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.image} alt="" className="h-full w-full object-cover" />
                ) : (
                  i.title.charAt(0)
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{i.title}</div>
                <div className="text-sm text-muted">{usd(i.price)} each</div>
                <div className="mt-2 flex items-center gap-1">
                  <QtyButton label="−" onClick={() => setQty(i.id, i.qty - 1)} />
                  <span className="w-8 text-center text-sm tabular-nums">{i.qty}</span>
                  <QtyButton label="+" disabled={i.qty >= i.stock} onClick={() => setQty(i.id, i.qty + 1)} />
                  <button onClick={() => setQty(i.id, 0)} className="ml-auto text-xs text-muted hover:text-warn">
                    remove
                  </button>
                </div>
              </div>
              <div className="font-semibold tabular-nums">{usd(i.price * i.qty)}</div>
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <div className="space-y-3 border-t-[1.5px] border-ink p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted">Subtotal</span>
              <span className="font-display text-4xl tabular-nums">{usd(subtotal)}</span>
            </div>
            <p className="text-xs text-muted">Free returns within 30 days. Want a better price? Ask the shopkeeper first.</p>
            <PayPalCheckout
              createOrder={async () => {
                const res = await fetch("/api/checkout", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ items: items.map((i) => ({ listingId: i.id, quantity: i.qty })) }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? "Checkout failed");
                return data.orderId as string;
              }}
              onPaid={(o) => {
                setPaidOrder(o);
                clear();
                celebrate();
              }}
            />
          </div>
        )}
      </aside>
    </div>
  );
}

function QtyButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="btn-line flex h-7 w-7 items-center justify-center rounded-full text-sm disabled:opacity-30"
    >
      {label}
    </button>
  );
}
