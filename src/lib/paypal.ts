// Thin server-side client for the PayPal REST APIs (sandbox by default).
// Covers OAuth, Catalog Products, Orders v2 and Payments (refunds).
// Without PAYPAL_CLIENT_ID/SECRET it runs in "demo" mode: same responses shape, simulated locally.

import { randomBytes } from "crypto";

export function paypalMode(): "sandbox" | "demo" {
  return process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET ? "sandbox" : "demo";
}

const BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

let cachedToken: { value: string; expiresAt: number } | null = null;

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new PayPalError("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set", 500);
  }
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new PayPalError("PayPal auth failed", res.status, data);
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  if (paypalMode() === "demo") return simulate(method, path, body) as T;
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(idempotencyKey ? { "PayPal-Request-Id": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = data?.details?.[0]?.description ?? data?.message ?? `PayPal ${method} ${path} failed`;
    throw new PayPalError(msg, res.status, data);
  }
  return data as T;
}

const money = (n: number) => n.toFixed(2);

// ---------- Catalog Products ----------

export type PayPalProduct = { id: string; name: string };

export function createCatalogProduct(p: {
  name: string;
  description: string;
  category?: string;
  imageUrl?: string;
}) {
  return call<PayPalProduct>("POST", "/v1/catalogs/products", {
    name: p.name.slice(0, 127),
    description: p.description.slice(0, 256),
    type: "PHYSICAL",
    category: p.category,
    // PayPal only accepts http(s) image URLs; data URLs from uploads are skipped.
    image_url: p.imageUrl?.startsWith("http") ? p.imageUrl : undefined,
  });
}

export function updateCatalogProduct(id: string, patch: { description?: string; category?: string }) {
  const ops = Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ({ op: "replace", path: `/${k}`, value: k === "description" ? String(v).slice(0, 256) : v }));
  if (!ops.length) return Promise.resolve({});
  return call("PATCH", `/v1/catalogs/products/${id}`, ops);
}

// ---------- Orders v2 ----------

export type OrderLine = { sku: string; name: string; unitPrice: number; quantity: number };

export type PayPalOrder = {
  id: string;
  status: string;
  purchase_units: Array<{
    payments?: { captures?: Array<{ id: string; status: string; amount: { value: string } }> };
  }>;
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } };
};

export function createOrder(lines: OrderLine[], opts: { description?: string; currency?: string } = {}) {
  const currency = opts.currency ?? "USD";
  const total = lines.reduce((s, l) => s + Math.round(l.unitPrice * 100) * l.quantity, 0) / 100;
  return call<PayPalOrder>("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        description: opts.description?.slice(0, 127),
        amount: {
          currency_code: currency,
          value: money(total),
          breakdown: { item_total: { currency_code: currency, value: money(total) } },
        },
        items: lines.map((l) => ({
          name: l.name.slice(0, 127),
          sku: l.sku,
          quantity: String(l.quantity),
          unit_amount: { currency_code: currency, value: money(l.unitPrice) },
          category: "PHYSICAL_GOODS",
        })),
      },
    ],
  });
}

export function getOrder(id: string) {
  return call<PayPalOrder>("GET", `/v2/checkout/orders/${id}`);
}

export function captureOrder(id: string) {
  return call<PayPalOrder>("POST", `/v2/checkout/orders/${id}/capture`, undefined, `capture-${id}`);
}

// ---------- Payments ----------

export function refundCapture(captureId: string, amount?: number, note?: string) {
  return call<{ id: string; status: string }>(
    "POST",
    `/v2/payments/captures/${captureId}/refund`,
    {
      ...(amount ? { amount: { value: money(amount), currency_code: "USD" } } : {}),
      note_to_payer: note?.slice(0, 255),
    },
    `refund-${captureId}-${amount ?? "full"}`,
  );
}

// ---------- Demo mode ----------
// Mimics the subset of PayPal responses this app reads. Nothing leaves the server.

const demoOrders = new Map<string, { status: string; value: string }>();
const demoId = (prefix: string) => `${prefix}-DEMO-${randomBytes(4).toString("hex").toUpperCase()}`;

function simulate(method: string, path: string, body: unknown): unknown {
  const b = body as Record<string, unknown> | undefined;
  if (method === "POST" && path === "/v1/catalogs/products") {
    return { id: demoId("PROD"), name: b?.name };
  }
  if (method === "PATCH" && path.startsWith("/v1/catalogs/products/")) return {};
  if (method === "POST" && path === "/v2/checkout/orders") {
    const units = b?.purchase_units as Array<{ amount: { value: string } }>;
    const id = demoId("ORDER");
    demoOrders.set(id, { status: "CREATED", value: units[0].amount.value });
    return { id, status: "CREATED", purchase_units: [{}] };
  }
  const capture = /^\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(path);
  if (method === "POST" && capture) {
    const order = demoOrders.get(capture[1]) ?? { status: "CREATED", value: "0.00" };
    order.status = "COMPLETED";
    demoOrders.set(capture[1], order);
    return {
      id: capture[1],
      status: "COMPLETED",
      purchase_units: [
        { payments: { captures: [{ id: demoId("CAPTURE"), status: "COMPLETED", amount: { value: order.value } }] } },
      ],
      payer: { email_address: "demo-buyer@example.com", name: { given_name: "Demo", surname: "Buyer" } },
    };
  }
  const get = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(path);
  if (method === "GET" && get) {
    return { id: get[1], status: demoOrders.get(get[1])?.status ?? "CREATED", purchase_units: [{}] };
  }
  if (method === "POST" && /^\/v2\/payments\/captures\/[^/]+\/refund$/.test(path)) {
    return { id: demoId("REFUND"), status: "COMPLETED" };
  }
  throw new PayPalError(`Demo mode does not simulate ${method} ${path}`, 501);
}
