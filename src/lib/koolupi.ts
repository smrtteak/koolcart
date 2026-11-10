// KoolUPI: Koolcart's built-in demo payment method, modelled on UPI. The shopper confirms with any 4-digit PIN.
// It's a model: no real money moves, no bank is contacted, and the PIN is only checked for shape — never stored,
// logged or compared with anything.
import { randomBytes, randomInt } from "crypto";

export class KoolUpiError extends Error {
  constructor(
    public code: "invalid_pin" | "invalid_upi_id",
    message: string,
  ) {
    super(message);
  }
}

export type UpiPayment = { paymentId: string; utr: string; upiId: string };

export const newOrderId = () => `KC-${randomBytes(5).toString("hex").toUpperCase()}`;

/** A UPI ID looks like name@handle. Optional: the sheet pre-fills a demo one. */
const UPI_ID = /^[a-z0-9._-]{2,40}@[a-z]{2,20}$/i;

export function pay(pin: string, upiId = "guest@koolupi"): UpiPayment {
  if (!/^\d{4}$/.test(pin)) throw new KoolUpiError("invalid_pin", "Enter a 4-digit PIN.");
  const id = upiId.trim().toLowerCase();
  if (!UPI_ID.test(id)) throw new KoolUpiError("invalid_upi_id", "That doesn't look like a UPI ID (name@bank).");
  // A 12-digit UTR, the reference number UPI apps show on a receipt.
  const utr = `${randomInt(1, 10)}${Array.from({ length: 11 }, () => randomInt(10)).join("")}`;
  return { paymentId: `upi_${randomBytes(9).toString("base64url")}`, utr, upiId: id };
}

export function refund(paymentId: string) {
  if (!paymentId.startsWith("upi_")) throw new KoolUpiError("invalid_upi_id", "Unknown KoolUPI payment");
  return { id: `rf_${randomBytes(9).toString("base64url")}`, status: "COMPLETED" };
}
