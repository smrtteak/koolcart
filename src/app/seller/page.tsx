"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Chat, postJSON, useLive, wire, type ChatHandle, type Step, type Turn } from "@/components/Chat";
import { usePayPalConfig } from "@/components/PayPalCheckout";

type Listing = {
  id: string;
  title: string;
  tagline: string;
  price: number;
  floorPrice: number;
  stock: number;
  category: string;
  image?: string;
  paypalProductId?: string;
};

type Order = {
  id: string;
  lines: { title: string; unitPrice: number; quantity: number }[];
  total: number;
  status: string;
  negotiated: boolean;
  payerName?: string;
  payerEmail?: string;
  refundedAmount?: number;
  createdAt: string;
  capturedAt?: string;
};

type ReturnRequest = {
  id: string;
  orderId: string;
  type: "return" | "exchange";
  reason: string;
  details?: string;
  status: "REQUESTED" | "APPROVED" | "DECLINED";
  refundId?: string;
  createdAt: string;
};

type Dashboard = { shopName: string; listings: Listing[]; orders: Order[]; returns: ReturnRequest[] };

const usd = (n: number) => `$${n.toFixed(2)}`;

const orderStatus: Record<string, [string, string]> = {
  COMPLETED: ["paid", "bg-[#bfe3c8]"],
  CREATED: ["not paid yet", "bg-paper"],
  REFUNDED: ["refunded", "bg-[#f7c6b0]"],
  PARTIALLY_REFUNDED: ["part refunded", "bg-[#f7c6b0]"],
};

const returnStatus: Record<ReturnRequest["status"], [string, string]> = {
  REQUESTED: ["needs a decision", "bg-accent"],
  APPROVED: ["approved", "bg-[#bfe3c8]"],
  DECLINED: ["declined", "bg-paper"],
};

const PASS_KEY = "koolcart.sellerPasscode";

export default function SellerStudio() {
  const config = usePayPalConfig();
  // undefined = not checked yet; "" = no passcode saved.
  const [passcode, setPasscode] = useState<string>();

  // Remembering the passcode for this tab is a convenience only; storage may be unavailable.
  useEffect(() => {
    let saved = "";
    try {
      saved = sessionStorage.getItem(PASS_KEY) ?? "";
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPasscode(saved);
  }, []);

  const save = (p: string) => {
    try {
      if (p) sessionStorage.setItem(PASS_KEY, p);
      else sessionStorage.removeItem(PASS_KEY);
    } catch {}
    setPasscode(p);
  };

  if (!config || passcode === undefined) return null;
  if (config.sellerLocked && !passcode) return <PasscodeGate onUnlock={save} />;
  return (
    <Studio
      headers={passcode ? { "x-seller-passcode": passcode } : {}}
      demoResetHours={config.demoResetHours}
      onLocked={() => save("")}
    />
  );
}

function Studio({
  headers,
  demoResetHours,
  onLocked,
}: {
  headers: Record<string, string>;
  demoResetHours: number | null;
  onLocked: () => void;
}) {
  const { data, refresh } = useLive<Dashboard & { locked?: boolean }>("/api/seller/dashboard", 3000, headers);
  const [tab, setTab] = useState<"shelf" | "orders" | "returns">("shelf");
  const [busyId, setBusyId] = useState<string>();
  const chat = useRef<ChatHandle>(null);
  const freshOrders = useFreshIds(data?.orders?.map((o) => o.id));

  // The passcode changed on the server, or was wrong: go back to the passcode screen.
  useEffect(() => {
    if (data?.locked) onLocked();
  }, [data?.locked, onLocked]);

  async function send(history: Turn[]) {
    const res = await postJSON<{ reply: string; steps: Step[]; listingIds: string[] }>("/api/seller/chat", {
      history: wire(history),
    }, headers);
    refresh();
    // Fetch the latest listings so the preview cards show what was just saved.
    const latest = (await fetch("/api/seller/dashboard", { headers }).then((r) => r.json())) as Dashboard;
    const touched = latest.listings.filter((l) => res.listingIds.includes(l.id));
    return {
      text: res.reply,
      steps: res.steps,
      extra: touched.length ? (
        <div className="space-y-2">
          {touched.map((l) => (
            <ListingPreview key={l.id} l={l} />
          ))}
        </div>
      ) : undefined,
    };
  }

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(undefined);
      refresh();
    }
  }

  async function patchJSON(url: string, body: unknown) {
    const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Request failed");
    return data;
  }

  const orders = data?.orders ?? [];
  const listings = data?.listings ?? [];
  const returns = (data?.returns ?? []).slice().reverse();
  const openReturns = returns.filter((r) => r.status === "REQUESTED").length;
  const paid = orders.filter((o) => o.status !== "CREATED");
  const revenue = paid.reduce((s, o) => s + o.total - (o.refundedAmount ?? 0), 0);
  const haggled = paid.filter((o) => o.negotiated).length;

  return (
    <div className="grid gap-8 lg:grid-cols-[400px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <Chat
          ref={chat}
          className="h-[600px] lg:h-[calc(100vh-8.5rem)]"
          title="Shop helper"
          subtitle="Lists things, sorts prices, handles refunds"
          intro={
            "Got something new to sell? Tell me about it in your own words. Snap a photo if you can, and I'll write it up, suggest a price and put it on the shelf."
          }
          suggestions={["How's business?", "What's running low?", "Make my titles better"]}
          allowImages
          send={send}
        />
      </div>

      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-hand text-2xl text-brand">the back room</div>
            <h1 className="font-display text-5xl leading-none sm:text-6xl">{data?.shopName ?? " "}</h1>
          </div>
          <Link href="/" className="btn-line rounded-full px-4 py-2 text-sm hover:bg-accent">
            See the shop →
          </Link>
        </div>

        {demoResetHours && (
          <div className="card-soft -rotate-[0.4deg] rounded-2xl bg-[#fff6d8] px-4 py-3 text-sm">
            <span className="font-hand text-xl">psst, this is a demo shop.</span>{" "}
            <span className="text-muted">
              Go ahead and list, edit or refund things. Everything resets to the starter shelf every{" "}
              {demoResetHours === 1 ? "hour" : `${demoResetHours} hours`}, and all payments are PayPal sandbox.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Note label="Money in (after refunds)" value={<CountUp value={revenue} money />} color="bg-[#fff6d8]" rotate={-1} />
          <Note label="Orders paid" value={<CountUp value={paid.length} />} color="bg-paper" rotate={1} />
          <Note
            label="Won by haggling"
            value={
              <>
                <CountUp value={haggled} />
                <span className="ml-1 font-hand text-xl text-muted">of {paid.length}</span>
              </>
            }
            color="bg-[#dceaff]"
            rotate={-0.5}
          />
          <Note
            label="Returns to look at"
            value={<CountUp value={openReturns} />}
            color={openReturns ? "bg-[#f7c6b0]" : "bg-paper"}
            rotate={1.5}
          />
        </div>

        <div className="flex gap-1 border-b-[1.5px] border-ink">
          {(
            [
              ["shelf", `On the shelf (${listings.length})`],
              ["orders", `Orders (${orders.length})`],
              ["returns", `Returns${openReturns ? ` (${openReturns})` : ""}`],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative -mb-[1.5px] rounded-t-xl border-[1.5px] px-4 py-2 text-sm transition ${
                tab === t ? "border-ink border-b-background bg-background font-medium" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {label}
              {t === "orders" && freshOrders.size > 0 && tab !== "orders" && (
                <span className="sticker absolute -right-2 -top-2 rounded-full bg-accent px-1.5 font-hand text-sm">new!</span>
              )}
            </button>
          ))}
        </div>

        {tab === "shelf" && (
          <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
            {data && listings.length === 0 && (
              <Empty title="Nothing on the shelf yet." text="Tell the helper about something you want to sell." />
            )}
            {listings.map((l, i) => (
              <div
                key={l.id}
                className="card animate-[rise_.4s_ease-out_both] rounded-[20px] p-3"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="relative h-36 overflow-hidden rounded-[12px] border border-line bg-background">
                  {l.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center font-display text-6xl italic text-ink/20">
                      {l.title.charAt(0)}
                    </span>
                  )}
                  {l.paypalProductId && (
                    <span className="absolute bottom-2 left-2 rounded-full bg-paper/90 px-2 py-0.5 text-[10px] font-semibold italic text-brand-deep">
                      in PayPal catalog
                    </span>
                  )}
                </div>
                <div className="space-y-3 px-1 pt-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-display text-xl leading-tight">{l.title}</div>
                      <div className="text-xs text-muted">{l.category}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-xl">{usd(l.price)}</div>
                      <div className="font-hand text-base text-muted">won&apos;t go below {usd(l.floorPrice)}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <SmallButton
                        label="−"
                        disabled={busyId === l.id || l.stock === 0}
                        onClick={() => act(l.id, () => patchJSON(`/api/listings/${l.id}`, { stockDelta: -1 }))}
                      />
                      <span className={`w-16 text-center text-sm tabular-nums ${l.stock === 0 ? "text-warn" : ""}`}>
                        {l.stock === 0 ? "sold out" : `${l.stock} in stock`}
                      </span>
                      <SmallButton
                        label="+"
                        disabled={busyId === l.id}
                        onClick={() => act(l.id, () => patchJSON(`/api/listings/${l.id}`, { stockDelta: 1 }))}
                      />
                    </div>
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={() => chat.current?.send(`Improve the listing ${l.id} — sharper title and description.`)}
                        className="text-brand underline-offset-4 hover:underline"
                      >
                        reword
                      </button>
                      <button
                        onClick={() =>
                          confirm(`Take “${l.title}” off the shelf?`) &&
                          act(l.id, () => fetch(`/api/listings/${l.id}`, { method: "DELETE", headers }))
                        }
                        className="text-muted hover:text-warn"
                      >
                        remove
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "orders" && (
          <div className="card-soft divide-y divide-line overflow-hidden rounded-[20px]">
            {orders.length === 0 && <div className="p-8 text-center text-muted">No orders yet.</div>}
            {orders.map((o) => {
              const [label, color] = orderStatus[o.status] ?? [o.status, "bg-paper"];
              const refundable = o.status === "COMPLETED" || o.status === "PARTIALLY_REFUNDED";
              return (
                <div
                  key={o.id}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-4 ${freshOrders.has(o.id) ? "animate-[flash_1s_ease-out_3] bg-[#fff6d8]" : ""}`}
                >
                  <div className="w-24 font-display text-2xl tabular-nums">{usd(o.total)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      {o.lines.map((l) => `${l.quantity} × ${l.title}`).join(", ")}
                      {o.negotiated && <span className="ml-2 font-hand text-base text-brand">haggled</span>}
                    </div>
                    <div className="text-xs text-muted">
                      <span className="font-mono">{o.id}</span>
                      {(o.payerName || o.payerEmail) && ` · ${o.payerName || o.payerEmail}`}
                      {` · ${new Date(o.capturedAt ?? o.createdAt).toLocaleDateString()}`}
                      {o.refundedAmount ? ` · refunded ${usd(o.refundedAmount)}` : ""}
                    </div>
                  </div>
                  <span className={`sticker rounded-full px-2.5 font-hand text-base ${color}`}>{label}</span>
                  {refundable && (
                    <button
                      disabled={busyId === o.id}
                      onClick={() =>
                        confirm(`Refund ${usd(o.total - (o.refundedAmount ?? 0))} to the buyer via PayPal?`) &&
                        act(o.id, () => postJSON(`/api/orders/${o.id}/refund`, {}, headers))
                      }
                      className="btn-line rounded-full px-3 py-1 text-xs hover:bg-[#f7c6b0] disabled:opacity-40"
                    >
                      {busyId === o.id ? "refunding…" : "Refund"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "returns" && (
          <div className="space-y-4">
            {returns.length === 0 && (
              <Empty title="No returns. Nice." text="When a buyer asks to return or swap something, it shows up here." />
            )}
            {returns.map((r) => {
              const order = orders.find((o) => o.id === r.orderId);
              const [label, color] = returnStatus[r.status];
              return (
                <div key={r.id} className="card rounded-[20px] p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-display text-2xl capitalize">{r.type}</span>
                    <span className={`sticker rounded-full px-2.5 font-hand text-base ${color}`}>{label}</span>
                    <span className="ml-auto font-mono text-xs text-muted">{r.id}</span>
                  </div>
                  <div className="mt-2 text-sm">
                    <span className="font-medium">{r.reason}</span>
                    {r.details && <span className="text-muted">: “{r.details}”</span>}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    Order <span className="font-mono">{r.orderId}</span>
                    {order && ` · ${order.lines.map((l) => l.title).join(", ")} · ${usd(order.total)}`}
                    {` · asked ${new Date(r.createdAt).toLocaleDateString()}`}
                    {r.refundId && ` · PayPal refund ${r.refundId}`}
                  </div>
                  {r.status === "REQUESTED" && (
                    <div className="mt-4 flex gap-2">
                      <button
                        disabled={busyId === r.id}
                        onClick={() =>
                          (r.type === "exchange" ||
                            confirm(`Approve and refund ${order ? usd(order.total) : "the order"} through PayPal?`)) &&
                          act(r.id, () => patchJSON(`/api/returns/${r.id}`, { action: "approve" }))
                        }
                        className="btn-ink rounded-full px-4 py-2 text-sm disabled:opacity-40"
                      >
                        {busyId === r.id ? "working…" : r.type === "return" ? "Approve & refund via PayPal" : "Approve exchange"}
                      </button>
                      <button
                        disabled={busyId === r.id}
                        onClick={() => act(r.id, () => patchJSON(`/api/returns/${r.id}`, { action: "decline" }))}
                        className="btn-line rounded-full px-4 py-2 text-sm disabled:opacity-40"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Ids that appeared after the first load, so new orders can be highlighted. */
function useFreshIds(ids: string[] | undefined) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const key = ids?.join(",");
  useEffect(() => {
    if (!ids) return;
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    if (!added.length) return;
    added.forEach((id) => seen.current!.add(id));
    setFresh((prev) => new Set([...prev, ...added]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return fresh;
}

function useCountUp(target: number) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      setValue(begin + (target - begin) * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function CountUp({ value, money }: { value: number; money?: boolean }) {
  const shown = useCountUp(value);
  return <>{money ? usd(shown) : Math.round(shown)}</>;
}

/** A stat written on a slightly crooked sticky note. */
function Note({ label, value, color, rotate }: { label: string; value: React.ReactNode; color: string; rotate: number }) {
  return (
    <div className={`card rounded-[14px] p-4 ${color}`} style={{ transform: `rotate(${rotate}deg)` }}>
      <div className="font-hand text-lg leading-tight text-muted">{label}</div>
      <div className="mt-1 font-display text-4xl tabular-nums leading-none">{value}</div>
    </div>
  );
}

function ListingPreview({ l }: { l: Listing }) {
  return (
    <div className="card flex gap-3 rounded-2xl p-2.5">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-background font-display text-2xl italic text-ink/30">
        {l.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.image} alt="" className="h-full w-full object-cover" />
        ) : (
          l.title.charAt(0)
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-lg leading-tight">{l.title}</div>
        <div className="line-clamp-1 text-xs text-muted">{l.tagline}</div>
        <div className="mt-1 text-xs">
          <b>{usd(l.price)}</b>{" "}
          <span className="text-muted">
            · floor {usd(l.floorPrice)} · {l.stock} in stock
          </span>
        </div>
      </div>
      <Link href="/" className="self-center px-2 font-hand text-lg text-brand hover:underline">
        see it →
      </Link>
    </div>
  );
}

function SmallButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
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

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="col-span-full rounded-[20px] border-[1.5px] border-dashed border-ink/30 p-10 text-center">
      <div className="font-display text-3xl italic">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{text}</p>
    </div>
  );
}

function PasscodeGate({ onUnlock }: { onUnlock: (passcode: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/seller/dashboard", { headers: { "x-seller-passcode": value } }).catch(() => null);
    setBusy(false);
    if (res?.ok) onUnlock(value);
    else setError("That's not it. Check the passcode and try again.");
  }

  return (
    <div className="mx-auto max-w-md pt-10">
      <form onSubmit={submit} className="card rounded-[24px] p-8">
        <div className="font-hand text-2xl text-brand">staff only, mostly</div>
        <h1 className="font-display text-5xl leading-none">The back room</h1>
        <p className="mt-3 text-sm text-muted">
          Enter the seller passcode to list products, see orders and handle refunds. Judges: it&apos;s in the project
          description.
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Seller passcode"
          autoFocus
          className="mt-6 w-full rounded-xl border-[1.5px] border-ink bg-background/50 px-4 py-3 text-sm outline-none focus:bg-paper"
        />
        {error && <p className="mt-2 text-sm text-warn">{error}</p>}
        <button disabled={busy || !value} className="btn-ink mt-4 w-full rounded-full py-3 text-sm font-semibold disabled:opacity-40">
          {busy ? "Checking…" : "Open the back room"}
        </button>
        <Link href="/" className="mt-4 block text-center text-sm text-muted underline decoration-dotted underline-offset-4">
          ← back to the shop
        </Link>
      </form>
    </div>
  );
}
