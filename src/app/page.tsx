"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/components/Cart";
import { Chat, postJSON, useLive, wire, type ChatHandle, type Step, type Turn } from "@/components/Chat";
import { PayPalCheckout } from "@/components/PayPalCheckout";
import { celebrate } from "@/components/celebrate";

type Product = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  tags: string[];
  image?: string;
  sellerName?: string;
  createdAt: string;
};

type Sale = { title: string; total: number; negotiated: boolean; at: string };
type Shop = { shopName: string; listings: Product[]; recent: Sale[]; now: number };
type Checkout = { orderId: string; total: number; lines: { title: string; unitPrice: number; quantity: number }[] };
type Paid = { id: string; total: number; payerName?: string };

const NEW_MS = 24 * 60 * 60 * 1000;
const usd = (n: number) => `$${n.toFixed(2)}`;
// Starter-catalog items have no seller name; they belong to the house shop.
const maker = (p: { sellerName?: string }) => p.sellerName ?? "Koolcart";
// Small, stable per-item rotation so stickers look placed by hand.
const tiltOf = (id: string) => ((id.charCodeAt(0) + id.charCodeAt(id.length - 1)) % 7) - 3;

function ago(iso: string, now: number) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

const PROMPTS = ["a gift under $10", "something for a teenager", "what's new this week", "your best deal"];

export default function Storefront() {
  const { data: shop, refresh } = useLive<Shop>("/api/shop");
  const cart = useCart();
  const [open, setOpen] = useState<Product | null>(null);
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState<"new" | "low" | "high">("new");
  const [makerFilter, setMakerFilter] = useState("All makers");
  const [offerFor, setOfferFor] = useState<Product | null>(null);
  const chat = useRef<ChatHandle>(null);
  const chatBox = useRef<HTMLDivElement>(null);

  const listings = useMemo(() => shop?.listings ?? [], [shop]);
  const now = shop?.now ?? 0;
  const byId = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const categories = useMemo(() => ["All", ...new Set(listings.map((l) => l.category))], [listings]);
  const makers = useMemo(() => [...new Set(listings.map(maker))].sort((a, b) => a.localeCompare(b)), [listings]);

  const visible = useMemo(() => {
    const filtered = listings.filter(
      (l) => (category === "All" || l.category === category) && (makerFilter === "All makers" || maker(l) === makerFilter),
    );
    return filtered.sort((a, b) =>
      sort === "low" ? a.price - b.price : sort === "high" ? b.price - a.price : b.createdAt.localeCompare(a.createdAt),
    );
  }, [listings, category, sort, makerFilter]);

  const ask = (text: string) => {
    chat.current?.send(text);
    setOpen(null);
    setOfferFor(null);
    // On small screens the chat sits below the grid; bring it into view.
    if (window.innerWidth < 1024) chatBox.current?.scrollIntoView({ behavior: "smooth" });
  };

  const addToCart = (p: Product) => {
    cart.add({ id: p.id, title: p.title, price: p.price, image: p.image, stock: p.stock });
    setOpen(null);
  };

  const onPaid = () => {
    celebrate();
    refresh();
  };

  async function send(history: Turn[]) {
    const res = await postJSON<{ reply: string; checkouts: Checkout[]; steps: Step[]; productIds: string[] }>(
      "/api/shop/chat",
      { history: wire(history) },
    );
    const mentioned = res.productIds.map((id) => byId.get(id)).filter((p): p is Product => !!p);
    const offers = res.steps.filter((s) => s.tool === "evaluate_offer" && !s.error);
    const hasExtra = res.checkouts.length || mentioned.length || offers.length;
    return {
      text: res.reply,
      steps: res.steps,
      extra: hasExtra ? (
        <div className="space-y-3">
          {offers.map((s, i) => {
            let resolvedId = String(s.input.id);
            try {
              resolvedId = JSON.parse(s.output).id ?? resolvedId;
            } catch {}
            const p = byId.get(resolvedId);
            return p ? <HaggleMeter key={i} p={p} step={s} /> : null;
          })}
          {!res.checkouts.length && mentioned.length > 0 && (
            <div className="scrollbar-none -mr-5 flex gap-3 overflow-x-auto pb-2 pr-5 pt-1">
              {mentioned.map((p) => (
                <MiniProduct key={p.id} p={p} onOpen={() => setOpen(p)} />
              ))}
            </div>
          )}
          {res.checkouts.map((c) => (
            <Receipt key={c.orderId} c={c} onPaid={onPaid} />
          ))}
        </div>
      ) : undefined,
    };
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-7">
        <Hero shopName={shop?.shopName} onAsk={ask} />
        <Ticker sales={shop?.recent ?? []} now={now} />

        {listings.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <h2 className="mr-auto font-display text-4xl leading-none">
              On the shelf{" "}
              <span className="font-hand text-2xl text-muted">
                ({listings.length} things from {makers.length} {makers.length === 1 ? "maker" : "makers"})
              </span>
            </h2>
            <div className="scrollbar-none flex gap-1.5 overflow-x-auto">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`shrink-0 rounded-full border-[1.5px] px-3.5 py-1 text-sm transition ${
                    category === c ? "border-ink bg-ink text-paper" : "border-line text-muted hover:border-ink hover:text-ink"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            {makers.length > 1 && (
              <select
                value={makerFilter}
                onChange={(e) => setMakerFilter(e.target.value)}
                aria-label="Filter by maker"
                className="rounded-full border-[1.5px] border-line bg-transparent px-3 py-1 text-sm text-muted outline-none focus:border-ink"
              >
                <option>All makers</option>
                {makers.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            )}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="rounded-full border-[1.5px] border-line bg-transparent px-3 py-1 text-sm text-muted outline-none focus:border-ink"
            >
              <option value="new">Newest first</option>
              <option value="low">Cheapest first</option>
              <option value="high">Priciest first</option>
            </select>
          </div>
        )}

        {shop && listings.length === 0 && (
          <div className="card rounded-[24px] p-12 text-center">
            <div className="font-display text-4xl italic">The shelves are bare.</div>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
              We&apos;re restocking. Got something to sell? Head to{" "}
              <Link className="text-ink underline underline-offset-4" href="/seller">
                Sell
              </Link>{" "}
              and tell the helper what you&apos;ve got.
            </p>
          </div>
        )}

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p, i) => (
            <ProductCard
              key={p.id}
              p={p}
              index={i}
              isNew={now - new Date(p.createdAt).getTime() < NEW_MS}
              inCart={cart.items.some((c) => c.id === p.id)}
              onOpen={() => setOpen(p)}
              onAdd={() => addToCart(p)}
              onOffer={() => setOfferFor(p)}
            />
          ))}
        </div>
      </div>

      <div ref={chatBox} className="lg:sticky lg:top-24 lg:self-start">
        <Chat
          ref={chat}
          className="h-[620px] lg:h-[calc(100vh-8.5rem)]"
          title="The shopkeeper"
          subtitle="Ask about anything on the shelf. Offers welcome."
          intro="Hi there! Looking for anything in particular? I know every item on these shelves, and if a price feels a bit steep, make me an offer."
          suggestions={["What's popular?", "Anything under $10?", "Can I make an offer?"]}
          send={send}
        />
      </div>

      {open && (
        <ProductModal
          p={open}
          onClose={() => setOpen(null)}
          onAsk={() => ask(`Tell me more about the ${open.title}.`)}
          onAdd={() => addToCart(open)}
          onOffer={() => {
            setOfferFor(open);
            setOpen(null);
          }}
          onPaid={onPaid}
        />
      )}

      {offerFor && (
        <OfferDialog
          p={offerFor}
          onClose={() => setOfferFor(null)}
          onSend={(price) => ask(`Would you take ${usd(price)} for the ${offerFor.title}?`)}
        />
      )}
    </div>
  );
}

function Hero({ shopName, onAsk }: { shopName?: string; onAsk: (t: string) => void }) {
  const [q, setQ] = useState("");
  const [hint, setHint] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setHint((h) => (h + 1) % PROMPTS.length), 2800);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="card relative overflow-hidden rounded-[28px] px-6 py-10 sm:px-10 sm:py-12">
      <span className="sticker absolute right-5 top-5 hidden rotate-6 rounded-full bg-accent px-3 py-1 font-hand text-lg sm:block">
        offers welcome!
      </span>
      <div className="font-hand text-2xl text-brand">{shopName ? `Welcome to ${shopName}` : "Welcome in"}</div>
      <h1 className="mt-1 max-w-2xl font-display text-[clamp(2.6rem,6.5vw,5rem)] leading-[.95] tracking-tight">
        Little things, <span className="scribble italic">picked</span> with care.
      </h1>
      <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted">
        Have a look around. If you&apos;re not sure what you want, ask the shopkeeper. And if a price
        feels a bit high, go ahead and make an offer. We don&apos;t mind.
      </p>
      <form
        className="mt-7 flex max-w-xl items-center gap-2 rounded-full border-[1.5px] border-ink bg-background/60 p-1.5 pl-5 transition focus-within:bg-paper focus-within:shadow-[3px_3px_0_var(--ink)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) onAsk(q.trim());
          setQ("");
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`I'm looking for ${PROMPTS[hint]}…`}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted"
        />
        <button className="btn-ink shrink-0 rounded-full px-5 py-2 text-sm font-semibold transition hover:-rotate-2">
          Ask
        </button>
      </form>
    </section>
  );
}

function Ticker({ sales, now }: { sales: Sale[]; now: number }) {
  const items = sales.length
    ? sales.map(
        (s) => `Someone picked up the ${s.title} for ${usd(s.total)}${s.negotiated ? " after a little haggling" : ""} · ${ago(s.at, now)}`,
      )
    : ["Free returns for 30 days", "Pay safely with PayPal", "Make an offer on anything", "New things added every week"];
  const loop = [...items, ...items];
  return (
    <div className="overflow-hidden border-y-[1.5px] border-dashed border-ink/30 py-2.5 [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]">
      <div className="flex w-max animate-[marquee_45s_linear_infinite] gap-10 pl-10 font-hand text-xl text-muted">
        {loop.map((t, i) => (
          <span key={i} className="flex items-center gap-3 whitespace-nowrap">
            <span className="text-accent">✳</span>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProductCard({
  p,
  index,
  isNew,
  inCart,
  onOpen,
  onAdd,
  onOffer,
}: {
  p: Product;
  index: number;
  isNew: boolean;
  inCart: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onOffer: () => void;
}) {
  const soldOut = p.stock === 0;
  return (
    <div className="animate-[rise_.5s_ease-out_both]" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="card press group relative rounded-[22px] bg-paper p-3">
        <button
          onClick={onOpen}
          className="relative block aspect-[4/3] w-full overflow-hidden rounded-[14px] border border-line bg-background"
          aria-label={`Open ${p.title}`}
        >
          {p.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.image}
              alt={p.title}
              className={`h-full w-full object-cover transition duration-500 group-hover:scale-[1.04] ${soldOut ? "grayscale opacity-60" : ""}`}
            />
          ) : (
            <span className="flex h-full items-center justify-center font-display text-7xl italic text-ink/20">
              {p.title.charAt(0)}
            </span>
          )}
        </button>
        {(isNew || soldOut || p.stock <= 2) && (
          <span
            className={`sticker absolute left-1 top-1 rounded-full px-2.5 py-0.5 font-hand text-lg leading-tight ${
              soldOut ? "bg-paper text-muted" : isNew ? "bg-accent" : "bg-[#f7c6b0]"
            }`}
            style={{ transform: `rotate(${tiltOf(p.id) - 4}deg)` }}
          >
            {soldOut ? "all gone" : isNew ? "new in!" : `only ${p.stock} left`}
          </span>
        )}
        <div className="px-1 pb-1 pt-3">
          <div className="flex items-start justify-between gap-3">
            <button onClick={onOpen} className="min-w-0 text-left">
              <div className="font-display text-2xl leading-tight">{p.title}</div>
              <div className="mt-0.5 line-clamp-1 text-sm text-muted">{p.tagline}</div>
              <div className="font-hand text-lg leading-tight text-brand">by {maker(p)}</div>
            </button>
            <div className="shrink-0 font-display text-2xl tabular-nums">{usd(p.price)}</div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={onAdd}
              disabled={soldOut}
              className="btn-ink flex-1 rounded-full py-2 text-sm font-medium transition hover:-translate-y-px disabled:opacity-30"
            >
              {inCart ? "Add another" : "Add to cart"}
            </button>
            <button
              onClick={onOffer}
              disabled={soldOut}
              className="btn-line rounded-full px-3.5 py-2 text-sm transition hover:bg-accent disabled:opacity-30"
            >
              Make an offer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OfferDialog({ p, onClose, onSend }: { p: Product; onClose: () => void; onSend: (price: number) => void }) {
  const min = Math.max(1, Math.floor(p.price * 0.5));
  const max = Math.ceil(p.price);
  const [price, setPrice] = useState(Math.max(min, Math.round(p.price * 0.85 * 2) / 2));
  const pct = Math.round((1 - price / p.price) * 100);
  const fill = ((price - min) / Math.max(1, max - min)) * 100;
  const mood =
    pct <= 10 ? "they'll probably say yes" : pct <= 25 ? "worth a try" : pct <= 40 ? "bold move" : "cheeky… but sure";
  return (
    <Modal onClose={onClose} narrow>
      <div className="space-y-6 p-7">
        <div className="flex items-center gap-3">
          <Thumb src={p.image} title={p.title} size={52} />
          <div>
            <div className="font-hand text-xl text-brand">make an offer on</div>
            <div className="font-display text-2xl leading-tight">{p.title}</div>
          </div>
        </div>
        <div className="text-center">
          <div className="font-display text-7xl tabular-nums">{usd(price)}</div>
          <div className="mt-1 text-sm text-muted">
            {pct > 0 ? `${pct}% off the ${usd(p.price)} tag` : "full price"} ·{" "}
            <span className="font-hand text-lg text-ink">{mood}</span>
          </div>
        </div>
        <div className="relative">
          <div className="h-2.5 rounded-full border border-ink bg-background">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${fill}%` }} />
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={0.5}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            aria-label="Your offer"
            className="absolute inset-0 h-2.5 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#1f1b16] [&::-webkit-slider-thumb]:bg-[#fffcf6]"
          />
          <div className="mt-3 flex justify-between text-xs text-muted">
            <span>{usd(min)}</span>
            <span>tag price {usd(p.price)}</span>
          </div>
        </div>
        <button onClick={() => onSend(price)} className="btn-ink w-full rounded-full py-3.5 text-sm font-semibold">
          Send my offer
        </button>
        <p className="text-center text-xs text-muted">
          The shopkeeper will answer in the chat: yes, no, or a counter-offer.
        </p>
      </div>
    </Modal>
  );
}

/** Where the offer and the shop's answer sit against the tag price. */
function HaggleMeter({ p, step }: { p: Product; step: Step }) {
  let v: { verdict?: string; price?: number; counter?: number } = {};
  try {
    v = JSON.parse(step.output);
  } catch {}
  const offer = Number(step.input.offeredUnitPrice);
  const answer = v.price ?? v.counter ?? p.price;
  const lo = p.price * 0.5;
  const pos = (n: number) => `${Math.min(100, Math.max(0, ((n - lo) / (p.price - lo)) * 100))}%`;
  const accepted = v.verdict === "accept";
  return (
    <div className="rounded-2xl border-[1.5px] border-dashed border-ink/40 bg-background/60 p-4">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-xs text-muted">{p.title}</span>
        <span className="font-hand text-xl">
          {accepted ? "deal! 🤝" : v.verdict === "counter" ? "counter-offer" : "not this time"}
        </span>
      </div>
      <div className="relative mx-6 h-1.5 rounded-full bg-surface-strong">
        <div
          className="absolute h-1.5 rounded-full bg-accent"
          style={{ left: pos(Math.min(offer, answer)), right: `calc(100% - ${pos(Math.max(offer, answer))})` }}
        />
        <Marker at={pos(offer)} label={`you ${usd(offer)}`} tone="bg-brand" top />
        <Marker at={pos(answer)} label={`${accepted ? "agreed" : "shop"} ${usd(answer)}`} tone="bg-ok" />
        {answer !== p.price && <Marker at="100%" label={`tag ${usd(p.price)}`} tone="bg-paper" top />}
      </div>
      <div className="h-6" />
    </div>
  );
}

function Marker({ at, label, tone, top }: { at: string; label: string; tone: string; top?: boolean }) {
  return (
    <div className="absolute -translate-x-1/2" style={{ left: at, top: -6 }}>
      <div className={`h-4 w-4 rounded-full border-[1.5px] border-ink ${tone}`} />
      <div className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-ink ${top ? "-top-5" : "top-5"}`}>
        {label}
      </div>
    </div>
  );
}

function MiniProduct({ p, onOpen }: { p: Product; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="card press w-32 shrink-0 rounded-2xl p-1.5 text-left"
      style={{ transform: `rotate(${tiltOf(p.id) / 2}deg)` }}
    >
      <span className="block aspect-square overflow-hidden rounded-xl bg-background">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center font-display text-4xl italic text-ink/20">
            {p.title.charAt(0)}
          </span>
        )}
      </span>
      <span className="block px-1 pt-1.5">
        <span className="line-clamp-1 text-xs font-medium">{p.title}</span>
        <span className="font-display text-lg">{usd(p.price)}</span>
      </span>
    </button>
  );
}

/** Checkout card styled as a paper till receipt. */
function Receipt({ c, onPaid }: { c: Checkout; onPaid: () => void }) {
  const [paid, setPaid] = useState<Paid>();
  return (
    <div className="card relative rounded-xl bg-paper font-mono text-[12px]">
      <div className="p-4 pb-3">
        <div className="text-center">
          <div className="font-display text-2xl not-italic">Koolcart</div>
          <div className="text-[10px] uppercase tracking-[.2em] text-muted">order {c.orderId}</div>
        </div>
        <div className="perforated my-3" />
        {c.lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-3">
            <span className="truncate">
              {l.quantity} × {l.title}
            </span>
            <span className="tabular-nums">{usd(l.unitPrice * l.quantity)}</span>
          </div>
        ))}
        <div className="perforated my-3" />
        <div className="flex items-baseline justify-between">
          <span className="uppercase tracking-widest">Total</span>
          <span className="font-display text-3xl tabular-nums">{usd(c.total)}</span>
        </div>
      </div>
      <div className="border-t-[1.5px] border-dashed border-ink/40 p-3 font-sans">
        {paid ? (
          <div className="space-y-1 text-center">
            <div className="font-hand text-2xl text-ok">paid, thank you! ✓</div>
            <Link
              href={`/returns?order=${c.orderId}`}
              className="text-xs text-muted underline decoration-dotted underline-offset-4"
            >
              Need to return or swap it?
            </Link>
          </div>
        ) : (
          <PayPalCheckout
            orderId={c.orderId}
            onPaid={(o) => {
              setPaid(o);
              onPaid();
            }}
          />
        )}
      </div>
    </div>
  );
}

function ProductModal({
  p,
  onClose,
  onAsk,
  onAdd,
  onOffer,
  onPaid,
}: {
  p: Product;
  onClose: () => void;
  onAsk: () => void;
  onAdd: () => void;
  onOffer: () => void;
  onPaid: () => void;
}) {
  return (
    <Modal onClose={onClose}>
      <div className="grid md:grid-cols-2">
        <div className="relative aspect-square border-b-[1.5px] border-ink bg-background md:aspect-auto md:border-b-0 md:border-r-[1.5px]">
          {p.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image} alt={p.title} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full min-h-60 items-center justify-center font-display text-9xl italic text-ink/15">
              {p.title.charAt(0)}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-4 p-7">
          <div className="font-hand text-xl text-brand">
            {p.category.toLowerCase()} · from {maker(p)}&apos;s shelf
          </div>
          <h2 className="-mt-3 font-display text-4xl leading-[1.05]">{p.title}</h2>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-3xl tabular-nums">{usd(p.price)}</span>
            <span className={`text-sm ${p.stock === 0 ? "text-warn" : "text-muted"}`}>
              {p.stock === 0 ? "all gone, sorry" : p.stock === 1 ? "last one" : `${p.stock} left`}
            </span>
          </div>
          <p className="text-[15px]">{p.tagline}</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{p.description}</p>
          <div className="flex flex-wrap gap-1.5">
            {p.tags.map((t) => (
              <span key={t} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">
                {t}
              </span>
            ))}
          </div>
          <div className="mt-auto space-y-3 pt-2">
            {p.stock > 0 && (
              <button onClick={onAdd} className="btn-ink w-full rounded-full py-3 text-sm font-semibold">
                Add to cart
              </button>
            )}
            <div className="flex gap-2">
              <button onClick={onAsk} className="btn-line flex-1 rounded-full py-2.5 text-sm hover:bg-background">
                Ask a question
              </button>
              <button
                onClick={onOffer}
                disabled={p.stock === 0}
                className="btn-line flex-1 rounded-full py-2.5 text-sm hover:bg-accent disabled:opacity-30"
              >
                Make an offer
              </button>
            </div>
            {p.stock > 0 && (
              <>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-line" />
                  or buy it right now
                  <span className="h-px flex-1 bg-line" />
                </div>
                <PayPalCheckout
                  createOrder={async () =>
                    (await postJSON<{ orderId: string }>("/api/checkout", { listingId: p.id })).orderId
                  }
                  onPaid={onPaid}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Thumb({ src, title, size }: { src?: string; title: string; size: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl border-[1.5px] border-ink bg-background font-display text-2xl italic text-ink/30"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        title.charAt(0)
      )}
    </span>
  );
}

function Modal({ children, onClose, narrow }: { children: React.ReactNode; onClose: () => void; narrow?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-40 flex animate-[fadeIn_.15s_ease-out_both] items-end justify-center bg-ink/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className={`card relative max-h-[92vh] w-full animate-[rise_.3s_ease-out_both] overflow-y-auto rounded-t-[28px] sm:rounded-[28px] ${
          narrow ? "max-w-md" : "max-w-4xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="btn-line absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
