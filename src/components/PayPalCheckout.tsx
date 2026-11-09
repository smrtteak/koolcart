"use client";

import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { useEffect, useState } from "react";

type Config = {
  paypalClientId: string | null;
  paypalMode: "sandbox" | "demo";
  sellerLocked: boolean;
  demoResetHours: number | null;
};

let configPromise: Promise<Config> | null = null;
export function usePayPalConfig() {
  const [config, setConfig] = useState<Config>();
  useEffect(() => {
    configPromise ??= fetch("/api/config").then((r) => r.json());
    configPromise.then(setConfig);
  }, []);
  return config;
}

/** PayPal Smart Buttons bound to an order the server already created. */
export function PayPalCheckout({
  orderId,
  createOrder,
  onPaid,
}: {
  orderId?: string;
  createOrder?: () => Promise<string>;
  onPaid?: (order: { id: string; total: number; payerName?: string }) => void;
}) {
  const config = usePayPalConfig();
  const [status, setStatus] = useState<"idle" | "paid" | "error">("idle");
  const [message, setMessage] = useState("");
  const [demoOrderId, setDemoOrderId] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function capture(id: string) {
    const res = await fetch(`/api/checkout/${id}/capture`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      setStatus("error");
      setMessage(body.error ?? "Payment failed");
      return;
    }
    setStatus("paid");
    setMessage(`Paid $${body.order.total.toFixed(2)} — order ${body.order.id}`);
    onPaid?.(body.order);
  }

  if (!config) return <div className="h-11 animate-pulse rounded-full bg-surface-strong" />;
  if (status === "paid") {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-ok/10 px-3 py-2.5 text-sm font-medium text-ok">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok text-[11px] text-black">✓</span>
        {message}
      </div>
    );
  }

  if (config.paypalMode === "demo" || !config.paypalClientId) {
    // Stand-in for the PayPal popup while no sandbox credentials are configured.
    return (
      <div className="space-y-2">
        {!demoOrderId ? (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setDemoOrderId(orderId ?? (await createOrder?.()));
              } catch (e) {
                setStatus("error");
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="h-11 w-full rounded-full bg-[#ffc439] text-sm font-bold text-[#003087] transition hover:brightness-105 active:scale-[.98] disabled:opacity-50"
          >
            <span className="italic">Pay</span><span className="italic text-[#009cde]">Pal</span> · Pay now
          </button>
        ) : (
          <div className="animate-[fadeIn_.2s_ease-out] rounded-2xl border border-dashed border-accent/60 bg-accent/5 p-3 text-sm">
            <div className="mb-2 text-xs text-muted">
              Simulated PayPal approval · signed in as <b>Demo Buyer</b>
            </div>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await capture(demoOrderId);
                  setBusy(false);
                }}
                className="h-9 flex-1 rounded-full bg-[#0070e0] text-sm font-medium text-white disabled:opacity-50"
              >
                Approve payment
              </button>
              <button onClick={() => setDemoOrderId(undefined)} className="h-9 rounded-full px-3 text-sm text-muted">
                Cancel
              </button>
            </div>
          </div>
        )}
        <div className="text-[11px] text-muted">Demo mode — no real PayPal call is made.</div>
        {status === "error" && <div className="text-xs text-warn">{message}</div>}
      </div>
    );
  }

  const clientId = config.paypalClientId;
  return (
    <PayPalScriptProvider options={{ clientId, currency: "USD", intent: "capture" }}>
      {/* PayPal's iframe is light-scheme; matching it keeps the browser from painting it an opaque white box. */}
      <div style={{ colorScheme: "light" }}>
        <PayPalButtons
          style={{ layout: "vertical", shape: "pill", color: "gold", height: 44 }}
          createOrder={async () => {
            if (orderId) return orderId;
            if (createOrder) return createOrder();
            throw new Error("No order");
          }}
          onApprove={(data) => capture(data.orderID)}
          onError={(err) => {
            setStatus("error");
            setMessage(String(err));
          }}
        />
      </div>
      {status === "error" && <div className="mt-1 text-xs text-warn">{message}</div>}
    </PayPalScriptProvider>
  );
}

/** Header badge showing whether payments are real sandbox calls or simulated. */
export function PayPalModeBadge() {
  const config = usePayPalConfig();
  if (!config) return null;
  const live = config.paypalMode === "sandbox";
  return (
    <span
      title={live ? "Real PayPal sandbox API calls" : "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to use the real PayPal sandbox"}
      className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
        live ? "bg-ok/10 text-ok" : "bg-warn/10 text-warn"
      }`}
    >
      <span className="relative flex h-2 w-2">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${live ? "bg-ok" : "bg-warn"}`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-ok" : "bg-warn"}`} />
      </span>
      <span className="hidden sm:inline">{live ? "PayPal sandbox · live" : "PayPal demo · simulated"}</span>
      <span className="sm:hidden">{live ? "Live" : "Demo"}</span>
    </span>
  );
}
