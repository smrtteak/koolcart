"use client";

import { KoolUpiCheckout } from "./KoolUpi";
import { PayPalCheckout, usePayPalConfig } from "./PayPalCheckout";

type Paid = { id: string; total: number; payerName?: string };

/** The shop's pay button: KoolUPI by default, or PayPal Checkout when the server is set to PayPal. */
export function Checkout(props: {
  amount: number;
  orderId?: string;
  createOrder?: () => Promise<string>;
  onPaid?: (order: Paid) => void;
}) {
  const config = usePayPalConfig();
  if (!config) return <div className="h-12 animate-pulse rounded-full bg-surface-strong" />;
  if (config.paymentProvider === "paypal") return <PayPalCheckout {...props} />;
  return <KoolUpiCheckout {...props} />;
}
