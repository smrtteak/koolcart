// Koolcart's haggling policy. Deterministic and server-side: the shopkeeper AI only ever sees the verdict,
// never the floor price. Each listing has a style the seller picks; a buyer's later offers on the same item
// (in the same chat) earn bigger concessions, and under "fair" a persistent buyer can reach the floor.
import type { Listing } from "./store";

export const HAGGLE_STYLES = ["firm", "fair", "flexible"] as const;
export type HaggleStyle = (typeof HAGGLE_STYLES)[number];
export const DEFAULT_STYLE: HaggleStyle = "fair";

export const HAGGLE_STYLE_INFO: Record<HaggleStyle, string> = {
  firm: "Holds close to the tag. Never goes down to your lowest price.",
  fair: "Gives a little more each round. A buyer's 3rd offer can reach your lowest price.",
  flexible: "Accepts any offer at or above your lowest price straight away.",
};

export type Verdict = {
  verdict: "accept" | "counter" | "decline";
  /** Agreed unit price when accepted. */
  price?: number;
  /** The shop's counter-offer, binding if the buyer takes it. */
  counter?: number;
  /** True when the shop can't move further on this item: say it's the best and final price. */
  final?: boolean;
  /** Which offer on this item this is, in this chat (1 = first). */
  round: number;
  note?: string;
};

/**
 * For each style and round (1, 2, 3+): the buyer's offer is accepted at or above `floor + accept × gap`,
 * otherwise the shop counters at `floor + counter × gap` (gap = list price − floor). A counter of 0 is the floor.
 */
const STEPS: Record<HaggleStyle, { accept: number; counter: number }[]> = {
  firm: [
    { accept: 0.5, counter: 0.6 },
    { accept: 0.5, counter: 0.55 },
    { accept: 0.5, counter: 0.5 },
  ],
  fair: [
    { accept: 0.35, counter: 0.5 },
    { accept: 0.2, counter: 0.25 },
    { accept: 0, counter: 0 },
  ],
  flexible: [
    { accept: 0, counter: 0 },
    { accept: 0, counter: 0 },
    { accept: 0, counter: 0 },
  ],
};

/** Rounds a price up to the next 50 cents, so counters look like prices a person would say. */
const niceUp = (n: number) => Math.ceil(n * 2 - 1e-9) / 2;
const cents = (n: number) => Math.round(n * 100) / 100;

export function judgeOffer(l: Listing, offer: number, round: number): Verdict {
  const style = l.haggleStyle ?? DEFAULT_STYLE;
  if (offer >= l.price) return { verdict: "accept", price: l.price, round };
  const gap = l.price - l.floorPrice;
  if (gap <= 0) return { verdict: "decline", counter: l.price, final: true, round, note: "This item's price is fixed." };

  const step = STEPS[style][Math.min(round, 3) - 1];
  if (offer >= l.floorPrice + step.accept * gap - 1e-9) return { verdict: "accept", price: cents(offer), round };

  const counter =
    step.counter === 0
      ? l.floorPrice
      : Math.min(l.price, Math.max(l.floorPrice, niceUp(l.floorPrice + step.counter * gap)));
  // Never counter below what the buyer offered (that would be accepting less than they proposed).
  if (counter <= offer) return { verdict: "accept", price: cents(offer), round };
  return { verdict: "counter", counter: cents(counter), final: counter <= l.floorPrice + 1e-9, round };
}
