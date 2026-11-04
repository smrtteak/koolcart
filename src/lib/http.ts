import Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "crypto";
import { PayPalError } from "@/lib/paypal";

export function errorResponse(e: unknown) {
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
 * Seller-only routes call this first. With SELLER_PASSCODE unset the seller studio is open (handy for demos);
 * with it set, requests must carry the passcode in the `x-seller-passcode` header.
 * Returns a 401 response to send back, or null when the request may go ahead.
 */
export function sellerGuard(req: Request): Response | null {
  const expected = process.env.SELLER_PASSCODE;
  if (!expected) return null;
  const given = Buffer.from(req.headers.get("x-seller-passcode") ?? "");
  const want = Buffer.from(expected);
  if (given.length === want.length && timingSafeEqual(given, want)) return null;
  return Response.json({ error: "Seller passcode required", locked: true }, { status: 401 });
}
