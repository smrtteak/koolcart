"use client";

import { useEffect, useState } from "react";

type Paid = { id: string; total: number; payerName?: string; payment?: { utr?: string; upiId?: string } };

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * KoolUPI checkout: a "Pay with KoolUPI" button that opens a UPI-app style sheet. The shopper confirms with any
 * 4-digit PIN (it's a model; the PIN is never stored) and the order is placed.
 */
export function KoolUpiCheckout({
  amount,
  orderId,
  createOrder,
  onPaid,
}: {
  amount: number;
  orderId?: string;
  createOrder?: () => Promise<string>;
  onPaid?: (order: Paid) => void;
}) {
  const [open, setOpen] = useState(false);
  const [paid, setPaid] = useState<Paid>();

  if (paid) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-ok/10 px-3 py-2.5 text-sm text-ok">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok text-[11px] text-[#12110f]">✓</span>
        Paid {usd(paid.total)} with KoolUPI{paid.payment?.utr ? ` · UTR ${paid.payment.utr}` : ""}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-sm font-semibold text-[#12110f] transition hover:bg-[#fff8ea] active:scale-[.99]"
      >
        <UpiMark />
        Pay {usd(amount)} with KoolUPI
      </button>
      <p className="mt-1.5 text-center text-[11px] text-muted">Demo payment: no real money, any 4-digit PIN works.</p>
      {open && (
        <PaySheet
          amount={amount}
          orderId={orderId}
          createOrder={createOrder}
          onClose={() => setOpen(false)}
          onPaid={(o) => {
            setPaid(o);
            setOpen(false);
            onPaid?.(o);
          }}
        />
      )}
    </>
  );
}

function PaySheet({
  amount,
  orderId,
  createOrder,
  onClose,
  onPaid,
}: {
  amount: number;
  orderId?: string;
  createOrder?: () => Promise<string>;
  onClose: () => void;
  onPaid: (order: Paid) => void;
}) {
  const [upiId, setUpiId] = useState("you@koolupi");
  const [editingId, setEditingId] = useState(false);
  const [pin, setPin] = useState("");
  const [stage, setStage] = useState<"pin" | "processing" | "done">("pin");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Paid>();

  const press = (d: string) => {
    setError("");
    setPin((p) => (p.length < 4 ? p + d : p));
  };
  const back = () => setPin((p) => p.slice(0, -1));

  async function submit() {
    if (pin.length !== 4) return setError("Enter all 4 digits.");
    setStage("processing");
    try {
      const id = orderId ?? (await createOrder?.());
      if (!id) throw new Error("Couldn't start the order");
      // A short pause, like a real UPI app talking to the bank.
      const [res] = await Promise.all([
        fetch(`/api/checkout/${id}/pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin, upiId }),
        }),
        new Promise((r) => setTimeout(r, 1400)),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Payment failed");
      setResult(data.order);
      setStage("done");
      setTimeout(() => onPaid(data.order), 1600);
    } catch (e) {
      setError((e as Error).message);
      setPin("");
      setStage("pin");
    }
  }

  // Keyboard support: digits, Backspace, Enter, Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stage !== "pin" || editingId) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
      else if (e.key === "Enter") submit();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex animate-[fadeIn_.15s_ease-out] items-end justify-center bg-black/60 sm:items-center"
      onClick={() => stage === "pin" && onClose()}
    >
      <div
        className="w-full max-w-sm animate-[rise_.25s_ease-out] overflow-hidden rounded-t-[28px] border border-line bg-paper sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <UpiMark /> KoolUPI
          </div>
          {stage === "pin" && (
            <button onClick={onClose} className="text-xs text-muted hover:text-ink" aria-label="Cancel payment">
              Cancel
            </button>
          )}
        </div>

        {stage === "done" && result ? (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto flex h-16 w-16 animate-[rise_.3s_ease-out] items-center justify-center rounded-full bg-ok text-3xl text-[#12110f]">
              ✓
            </div>
            <div className="mt-4 font-display text-3xl">Payment successful</div>
            <div className="mt-1 text-sm text-muted">
              {usd(result.total)} paid to Koolcart
            </div>
            <div className="mx-auto mt-5 w-fit rounded-xl border border-line px-4 py-2 text-left font-mono text-[11px] text-muted">
              <div>UTR · {result.payment?.utr}</div>
              <div>Order · {result.id}</div>
              <div>From · {result.payment?.upiId}</div>
            </div>
          </div>
        ) : (
          <div className="px-5 pb-5 pt-4">
            <div className="text-center">
              <div className="text-xs text-muted">Paying</div>
              <div className="font-display text-2xl leading-tight">Koolcart</div>
              <div className="mt-1 font-display text-5xl tabular-nums">{usd(amount)}</div>
              <div className="mt-2 text-xs text-muted">
                from{" "}
                {editingId ? (
                  <input
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    onBlur={() => setEditingId(false)}
                    onKeyDown={(e) => e.key === "Enter" && setEditingId(false)}
                    autoFocus
                    aria-label="Your UPI ID"
                    className="w-40 rounded-md border border-line-strong bg-transparent px-2 py-0.5 text-center font-mono text-foreground outline-none"
                  />
                ) : (
                  <button
                    onClick={() => setEditingId(true)}
                    className="font-mono text-foreground underline decoration-dotted underline-offset-4"
                  >
                    {upiId}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-5 text-center text-sm">
              {stage === "processing" ? "Processing payment…" : "Enter your 4-digit UPI PIN"}
            </div>
            <div className="mt-3 flex justify-center gap-4" aria-live="polite" aria-label={`${pin.length} of 4 digits entered`}>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-3.5 w-3.5 rounded-full border border-line-strong transition ${
                    i < pin.length ? "scale-110 bg-ink" : ""
                  } ${stage === "processing" ? "animate-pulse bg-brand" : ""}`}
                />
              ))}
            </div>
            <div className="mt-2 h-4 text-center text-xs text-warn">{error}</div>

            <div className="mt-2 grid grid-cols-3 gap-2" aria-disabled={stage !== "pin"}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <Key key={d} label={d} onClick={() => press(d)} disabled={stage !== "pin"} />
              ))}
              <Key label="⌫" aria="Delete" onClick={back} disabled={stage !== "pin"} />
              <Key label="0" onClick={() => press("0")} disabled={stage !== "pin"} />
              <Key
                label={stage === "processing" ? "…" : "✓"}
                aria="Pay"
                onClick={submit}
                disabled={stage !== "pin" || pin.length !== 4}
                strong
              />
            </div>
            <p className="mt-4 text-center text-[11px] leading-relaxed text-muted">
              This is a demo: any 4 digits work and nothing is charged.
              <br />
              Don&apos;t use your real UPI PIN.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Key({
  label,
  onClick,
  disabled,
  strong,
  aria,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  strong?: boolean;
  aria?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={aria ?? label}
      className={`h-12 rounded-2xl text-lg font-medium transition active:scale-95 disabled:opacity-35 ${
        strong ? "bg-ink text-[#12110f]" : "bg-surface-strong hover:bg-[#2e2a25]"
      }`}
    >
      {label}
    </button>
  );
}

/** A small arrow mark in the spirit of UPI's logo, in Koolcart's colours. */
function UpiMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path d="M7 3l6 9-6 9" fill="none" stroke="#cfa86a" strokeWidth="3" strokeLinejoin="round" />
      <path d="M12 3l6 9-6 9" fill="none" stroke="#9cc7a1" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}
