"use client";

import { rememberOrder } from "@/lib/my-orders";
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
  // Every paid order lands in this browser's "Your orders" page.
  const onPaid = (order: Paid) => {
    rememberOrder(order.id);
    props.onPaid?.(order);
  };
  if (!config) return <div className="h-12 animate-pulse rounded-full bg-surface-strong" />;
  if (config.paymentProvider === "paypal") return <PayPalCheckout {...props} onPaid={onPaid} />;
  return <KoolUpiCheckout {...props} onPaid={onPaid} />;
}
