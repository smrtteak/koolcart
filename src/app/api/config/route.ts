import { connection } from "next/server";
import { paypalMode } from "@/lib/paypal";
import { demoResetHours } from "@/lib/store";

export async function GET() {
  await connection(); // read env at request time, not build time
  return Response.json({
    paypalClientId: process.env.PAYPAL_CLIENT_ID ?? null,
    paypalMode: paypalMode(),
    sellerLocked: Boolean(process.env.SELLER_PASSCODE),
    demoResetHours: demoResetHours(),
    // PayPal sandbox test card for guest checkout (fake money). Only meaningful in sandbox mode.
    testCard:
      paypalMode() === "sandbox" && process.env.PAYPAL_API_BASE?.includes("api-m.paypal.com") !== true
        ? {
            number: process.env.TEST_CARD_NUMBER ?? "4032030056309165",
            expiry: process.env.TEST_CARD_EXPIRY ?? "12/2031",
          }
        : null,
  });
}
