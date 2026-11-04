import Anthropic from "@anthropic-ai/sdk";
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
