// Tiny JSON-file datastore. Good enough for a hackathon demo; swap for a DB later.
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
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
  createdAt: string;
};

export type Order = {
  id: string; // PayPal order id
  lines: { listingId: string; title: string; unitPrice: number; quantity: number }[];
  total: number;
  status: "CREATED" | "COMPLETED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  negotiated: boolean;
  captureId?: string;
  payerEmail?: string;
  payerName?: string;
  refundedAmount?: number;
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

type DB = { shopName: string; listings: Listing[]; orders: Order[]; returns: ReturnRequest[] };

const FILE = process.env.DATA_FILE ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "store.json");

const EMPTY: DB = { shopName: "Koolcart", listings: [], orders: [], returns: [] };

// Serialize writes so concurrent requests don't clobber each other.
let queue: Promise<unknown> = Promise.resolve();

/** A fresh shop (new clone or deploy) opens with the starter catalog instead of empty shelves. */
function starterShop(): DB {
  const now = Date.now();
  const listings: Listing[] = starterCatalog.map(({ minutesAgo, ...l }) => ({
    ...l,
    createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
  }));
  return { ...structuredClone(EMPTY), listings };
}

async function load(): Promise<DB> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const db = starterShop();
    await save(db);
    return db;
  }
  // Older data files predate returns; fill in anything missing.
  return { ...structuredClone(EMPTY), ...JSON.parse(raw) } as DB;
}

async function save(db: DB) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(db, null, 2));
}

export function read(): Promise<DB> {
  return queue.then(load);
}

export function mutate<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const db = await load();
    const result = await fn(db);
    await save(db);
    return result;
  });
  queue = next.catch(() => {});
  return next;
}

export const newId = () => randomUUID().slice(0, 8);

/** Listing as buyers see it: floor price stripped. */
export function publicListing(l: Listing) {
  const { floorPrice: _floor, ...rest } = l;
  void _floor;
  return rest;
}
