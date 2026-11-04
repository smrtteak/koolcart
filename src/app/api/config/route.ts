import { connection } from "next/server";
import { paypalMode } from "@/lib/paypal";

export async function GET() {
  await connection(); // read env at request time, not build time
  return Response.json({ paypalClientId: process.env.PAYPAL_CLIENT_ID ?? null, paypalMode: paypalMode() });
}
