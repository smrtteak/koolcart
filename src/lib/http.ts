import Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "crypto";
import { KoolUpiError } from "@/lib/koolupi";
import { PayPalError } from "@/lib/paypal";
import { HOUSE_SELLER, sellerKey } from "@/lib/store";

export function errorResponse(e: unknown) {
  // Payment input problems are the shopper's to fix, not server errors; never log what they typed.
  if (e instanceof KoolUpiError) return Response.json({ error: e.message, code: e.code }, { status: 402 });
  console.error(e);
  if (e instanceof Anthropic.AuthenticationError) {
    return Response.json({ error: "Claude API key is missing or invalid (ANTHROPIC_API_KEY)." }, { status: 500 });
  }
  if (e instanceof Anthropic.RateLimitError) {
    return Response.json({ error: "The AI is busy right now — try again in a moment." }, { status: 429 });
  }
  if (e instanceof Anthropic.APIError) {
    return Response.json({ error: `AI error: ${e.message}` }, { status: 502 });
  }
  if (e instanceof PayPalError) {
    return Response.json({ error: `PayPal: ${e.message}`, details: e.details }, { status: e.status >= 500 ? 502 : 400 });
  }
  return Response.json({ error: (e as Error).message ?? "Unexpected error" }, { status: 400 });
}

/**
 * Every seller-only route calls this first. Sellers identify themselves by name (sent URI-encoded in the
 * `x-seller-name` header) and can only manage their own listings and orders. Anyone can sell under a new name;
 * the house account (HOUSE_SELLER, which owns the starter catalog) additionally needs SELLER_PASSCODE when set.
 * Returns the seller's name, or a response to send back.
 */
export function sellerAuth(req: Request): { name: string } | { denied: Response } {
  let name = "";
  try {
    name = decodeURIComponent(req.headers.get("x-seller-name") ?? "");
  } catch {}
  name = name.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) return { denied: Response.json({ error: "Tell us your name first", needsName: true }, { status: 401 }) };

  const expected = process.env.SELLER_PASSCODE;
  if (expected && sellerKey(name) === sellerKey(HOUSE_SELLER)) {
    const given = Buffer.from(req.headers.get("x-seller-passcode") ?? "");
    const want = Buffer.from(expected);
    if (!(given.length === want.length && timingSafeEqual(given, want))) {
      return { denied: Response.json({ error: "The house account needs the seller passcode", locked: true }, { status: 401 }) };
    }
  }
  return { name };
}
