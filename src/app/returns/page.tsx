"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

// Mirrors RETURN_REASONS in src/lib/store.ts (the server validates against that list).
const REASONS = [
  { value: "It doesn't fit", hint: "too big, too small, wrong size" },
  { value: "Arrived damaged or broken", hint: "cracked, torn, scratched in transit" },
  { value: "Not as described", hint: "looks or works differently than the listing" },
  { value: "Wrong item sent", hint: "we packed the wrong thing" },
  { value: "Changed my mind", hint: "no problem, it happens" },
  { value: "Arrived too late", hint: "missed the date you needed it for" },
  { value: "Something else", hint: "tell us below" },
] as const;

type Request = {
  id: string;
  orderId: string;
  type: "return" | "exchange";
  reason: string;
  status: "REQUESTED" | "APPROVED" | "DECLINED";
  createdAt: string;
};

const STATUS: Record<Request["status"], [string, string]> = {
  REQUESTED: ["waiting on the shop", "bg-accent"],
  APPROVED: ["approved", "bg-tint-green"],
  DECLINED: ["declined", "bg-tint-rose"],
};

export default function ReturnsPage() {
  return (
    <Suspense>
      <Returns />
    </Suspense>
  );
}

function Returns() {
  const params = useSearchParams();
  const [orderId, setOrderId] = useState(params.get("order") ?? "");
  const [type, setType] = useState<"return" | "exchange">("return");
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Request>();
  const [lookup, setLookup] = useState<Request[]>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!reason) return setError("Pick a reason so the shop knows what happened.");
    setBusy(true);
    try {
      const res = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: orderId.trim(), type, reason, details }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setDone(data.request);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    if (!orderId.trim()) return setError("Type your order number first.");
    setError("");
    const data = await fetch(`/api/returns?orderId=${encodeURIComponent(orderId.trim())}`).then((r) => r.json());
    setLookup(data.requests);
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="font-hand text-2xl text-brand">no fuss, promise</div>
        <h1 className="font-display text-5xl leading-none sm:text-6xl">Returns &amp; exchanges</h1>
        <p className="mt-3 max-w-lg text-muted">
          Something not quite right? Tell us what happened and we&apos;ll sort it out. Your order number is on the
          payment receipt and on the receipt in the shop chat.
        </p>

        {done ? (
          <div className="card mt-8 rounded-[24px] p-8">
            <div className="font-hand text-3xl">got it, thanks!</div>
            <p className="mt-2 text-muted">
              Your {done.type} request <span className="font-mono text-ink">{done.id}</span> for order{" "}
              <span className="font-mono text-ink">{done.orderId}</span> is with the shop.{" "}
              {done.type === "return"
                ? "Once it's approved, the refund goes straight back to the account you paid from."
                : "Once it's approved, we'll be in touch about your replacement."}
            </p>
            <div className="mt-6 flex gap-3">
              <Link href="/" className="btn-ink rounded-full px-5 py-2.5 text-sm font-semibold">
                Back to the shop
              </Link>
              <button
                onClick={() => {
                  setDone(undefined);
                  setReason("");
                  setDetails("");
                }}
                className="btn-line rounded-full px-5 py-2.5 text-sm"
              >
                Start another
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="card mt-8 space-y-7 rounded-[24px] p-6 sm:p-8">
            <Field n={1} label="Your order number">
              <div className="flex gap-2">
                <input
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                  placeholder="e.g. 4V1222599J869025M"
                  className="min-w-0 flex-1 rounded-xl border border-line-strong bg-background/50 px-4 py-2.5 font-mono text-sm outline-none focus:bg-paper"
                  required
                />
                <button type="button" onClick={checkStatus} className="btn-line shrink-0 rounded-xl px-3 text-sm">
                  Check status
                </button>
              </div>
              {lookup && (
                <div className="mt-3 space-y-2">
                  {lookup.length === 0 && <p className="font-hand text-lg text-muted">no requests on this order yet</p>}
                  {lookup.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-sm">
                      <span className="font-mono">{r.id}</span>
                      <span className="text-muted">
                        {r.type} · {r.reason}
                      </span>
                      <span className={`sticker ml-auto rounded-full px-2 font-hand text-base ${STATUS[r.status][1]}`}>
                        {STATUS[r.status][0]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Field>

            <Field n={2} label="What would you like?">
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["return", "Return it", "Send it back and get your money back."],
                    ["exchange", "Exchange it", "Swap for a different size, colour or item."],
                  ] as const
                ).map(([value, title, text]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setType(value)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      type === value ? "border-line-strong bg-accent/40" : "border-line hover:border-line-strong"
                    }`}
                  >
                    <div className="font-display text-2xl">{title}</div>
                    <div className="text-sm text-muted">{text}</div>
                  </button>
                ))}
              </div>
            </Field>

            <Field n={3} label="What happened?">
              <div className="grid gap-2 sm:grid-cols-2">
                {REASONS.map((r) => (
                  <label
                    key={r.value}
                    className={`flex cursor-pointer gap-3 rounded-xl border px-3.5 py-2.5 transition ${
                      reason === r.value ? "border-line-strong bg-paper" : "border-line hover:border-line-strong/60"
                    }`}
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={r.value}
                      checked={reason === r.value}
                      onChange={() => setReason(r.value)}
                      className="mt-1 accent-[#d4a659]"
                    />
                    <span>
                      <span className="block text-sm font-medium">{r.value}</span>
                      <span className="block text-xs text-muted">{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            <Field n={4} label="Anything else?" optional>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={type === "exchange" ? "What would you like instead? (size, colour…)" : "A photo description, what went wrong…"}
                className="w-full resize-none rounded-xl border border-line-strong bg-background/50 px-4 py-3 text-sm outline-none focus:bg-paper"
              />
            </Field>

            {error && <p className="rounded-xl bg-tint-rose/60 px-4 py-2.5 text-sm text-warn">{error}</p>}
            <button disabled={busy} className="btn-ink w-full rounded-full py-3.5 text-sm font-semibold disabled:opacity-50">
              {busy ? "Sending…" : `Send ${type} request`}
            </button>
          </form>
        )}
      </div>

      <aside className="space-y-4 lg:pt-28">
        <div className="card-soft -rotate-1 rounded-2xl bg-tint-amber p-5">
          <div className="font-hand text-2xl">the short version</div>
          <ul className="mt-2 space-y-2 text-sm text-muted">
            <li>✳ You have 30 days from the day you paid.</li>
            <li>✳ Refunds go back to the account you paid from as soon as they&apos;re approved.</li>
            <li>✳ Exchanges ship once the shop approves the swap.</li>
            <li>✳ Damaged or wrong item? Return shipping is on us.</li>
          </ul>
        </div>
        <div className="card-soft rotate-1 rounded-2xl p-5 text-sm text-muted">
          Still stuck? Ask{" "}
          <Link href="/" className="text-ink underline underline-offset-4">
            the shopkeeper
          </Link>{" "}
          in the shop chat. They can look up your order.
        </div>
      </aside>
    </div>
  );
}

function Field({
  n,
  label,
  optional,
  children,
}: {
  n: number;
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="sticker flex h-7 w-7 items-center justify-center rounded-full bg-accent font-hand text-lg">{n}</span>
        <span className="font-display text-2xl">{label}</span>
        {optional && <span className="font-hand text-lg text-muted">optional</span>}
      </div>
      {children}
    </div>
  );
}
