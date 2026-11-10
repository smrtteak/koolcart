// Tiny document store. Locally it's a JSON file; with DATABASE_URL set (e.g. a free Neon Postgres) the same
// document lives in one Postgres row, so every server instance and restart sees the same shared shop.
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Pool, type PoolClient } from "pg";
import starterCatalog from "./starter-catalog.json";

export type Listing = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  price: number;
  /** Lowest price the buyer agent may agree to. Never shown to buyers. */
  floorPrice: number;
  stock: number;
  category: string;
  tags: string[];
  image?: string;
  paypalProductId?: string;
  /** Who listed it, as they introduced themselves in the seller studio. */
  sellerName?: string;
  /** How hard the shopkeeper haggles on this item (see lib/haggle.ts). Defaults to "fair". */
  haggleStyle?: "firm" | "fair" | "flexible";
  createdAt: string;
};

/** Listings without a seller name (the starter catalog) belong to the house shop. */
export const HOUSE_SELLER = "Koolcart";
export const sellerOf = (l: Pick<Listing, "sellerName">) => l.sellerName ?? HOUSE_SELLER;
/** Seller names are matched case-insensitively. */
export const sellerKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export type Order = {
  id: string; // KC-… for KoolUPI, or the PayPal order id
  lines: { listingId: string; title: string; unitPrice: number; quantity: number; sellerName?: string }[];
  total: number;
  status: "CREATED" | "COMPLETED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  negotiated: boolean;
  captureId?: string;
  /** How the order was paid: the gateway, and for KoolUPI the payer's UPI ID and the transaction reference. */
  payment?: { gateway: "koolupi" | "paypal"; upiId?: string; utr?: string };
  payerEmail?: string;
  payerName?: string;
  refundedAmount?: number;
  /** Refunds per seller (by sellerKey), for orders that mix several sellers' items. */
  refundedBySeller?: Record<string, number>;
  createdAt: string;
  capturedAt?: string;
};

export const RETURN_REASONS = [
  "It doesn't fit",
  "Arrived damaged or broken",
  "Not as described",
  "Wrong item sent",
  "Changed my mind",
  "Arrived too late",
  "Something else",
] as const;

export type ReturnRequest = {
  id: string;
  orderId: string;
  type: "return" | "exchange";
  reason: (typeof RETURN_REASONS)[number];
  details?: string;
  status: "REQUESTED" | "APPROVED" | "DECLINED";
  refundId?: string;
  createdAt: string;
  resolvedAt?: string;
};

/**
 * A price the haggling policy offered or accepted in one chat. Checkout only honours discounts recorded here,
 * and the count per chat and item is the haggling "round". Kept in the shared store because a serverless
 * host may handle each chat message on a different instance.
 */
export type Deal = {
  conversationId: string;
  listingId: string;
  /** Which customer message (1-based) in the chat made the offer. Rounds count messages, not tool calls. */
  turn?: number;
  offer: number;
  /** The price the shop committed to: the accepted offer, or its counter-offer. */
  agreed: number;
  at: string;
};

type DB = {
  shopName: string;
  deals: Deal[];
  listings: Listing[];
  orders: Order[];
  returns: ReturnRequest[];
  /** When the shop was last (re)seeded from the starter catalog. */
  resetAt?: string;
};

const FILE = process.env.DATA_FILE ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "store.json");

const EMPTY: DB = { shopName: "Koolcart", listings: [], orders: [], returns: [], deals: [] };

/** A fresh shop (new clone or deploy) opens with the starter catalog instead of empty shelves. */
function starterShop(): DB {
  const now = Date.now();
  const listings: Listing[] = starterCatalog.map(({ minutesAgo, ...l }) => ({
    ...l,
    createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
  }));
  return { ...structuredClone(EMPTY), listings, resetAt: new Date(now).toISOString() };
}

/**
 * Public demo deployments set DEMO_RESET_HOURS so anything visitors change (deleted listings, test orders)
 * rolls back to the starter catalog on a schedule. Unset, the shop is never reset.
 */
export function demoResetHours(): number | null {
  const h = Number(process.env.DEMO_RESET_HOURS);
  return Number.isFinite(h) && h > 0 ? h : null;
}

function resetDue(db: DB) {
  const hours = demoResetHours();
  if (!hours) return false;
  const last = db.resetAt ? new Date(db.resetAt).getTime() : 0;
  return Date.now() - last >= hours * 3600_000;
}

/** Fills in fields older documents lack, and applies a scheduled demo reset if one is due. */
function prepare(raw: unknown): { db: DB; replaced: boolean } {
  const db = { ...structuredClone(EMPTY), ...(raw as Partial<DB>) } as DB;
  if (resetDue(db)) return { db: starterShop(), replaced: true };
  return { db, replaced: false };
}

// ---------- JSON file (local development) ----------

// Serialize writes so concurrent requests don't clobber each other.
let queue: Promise<unknown> = Promise.resolve();

async function loadFile(): Promise<DB> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const db = starterShop();
    await saveFile(db);
    return db;
  }
  const { db, replaced } = prepare(JSON.parse(raw));
  if (replaced) await saveFile(db);
  return db;
}

async function saveFile(db: DB) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(db, null, 2));
}

// ---------- Postgres (shared deployments) ----------

const DATABASE_URL = process.env.DATABASE_URL;
let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function db(): Pool {
  pool ??= new Pool({ connectionString: DATABASE_URL, max: 5 });
  return pool;
}

/** Creates the table and seeds the starter shop the first time. Safe to run on every boot. */
function ensureSchema() {
  ready ??= (async () => {
    await db().query("create table if not exists koolcart_store (id text primary key, doc jsonb not null)");
    await db().query("insert into koolcart_store (id, doc) values ('main', $1) on conflict (id) do nothing", [
      JSON.stringify(starterShop()),
    ]);
  })().catch((e) => {
    ready = null; // retry on the next request
    throw e;
  });
  return ready;
}

async function loadRow(client: PoolClient | Pool, lock: boolean): Promise<DB> {
  const { rows } = await client.query(`select doc from koolcart_store where id = 'main'${lock ? " for update" : ""}`);
  const { db: doc, replaced } = prepare(rows[0]?.doc);
  if (replaced) await saveRow(client, doc);
  return doc;
}

const saveRow = (client: PoolClient | Pool, doc: DB) =>
  client.query("update koolcart_store set doc = $1 where id = 'main'", [JSON.stringify(doc)]);

// ---------- Public API ----------

export async function read(): Promise<DB> {
  if (!DATABASE_URL) return queue.then(loadFile);
  await ensureSchema();
  return loadRow(db(), false);
}

/** Runs `fn` against the latest data and saves the result atomically. */
export async function mutate<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  if (!DATABASE_URL) {
    const next = queue.then(async () => {
      const doc = await loadFile();
      const result = await fn(doc);
      await saveFile(doc);
      return result;
    });
    queue = next.catch(() => {});
    return next;
  }
  await ensureSchema();
  const client = await db().connect();
  try {
    await client.query("begin");
    const doc = await loadRow(client, true); // row lock: concurrent writers wait their turn
    const result = await fn(doc);
    await saveRow(client, doc);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Where shop data lives, for the status line in docs and logs. */
export const storageMode = () => (DATABASE_URL ? "postgres" : "file");

export const newId = () => randomUUID().slice(0, 8);

/** Listing as buyers see it: floor price stripped. */
export function publicListing(l: Listing) {
  const { floorPrice: _floor, ...rest } = l;
  void _floor;
  return rest;
}
