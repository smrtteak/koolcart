// Which payment method the shop uses. KoolUPI (built-in demo UPI) by default; PAYMENT_PROVIDER=paypal switches
// back to PayPal Checkout using the PAYPAL_* credentials.
export type PaymentProvider = "koolupi" | "paypal";

export const paymentProvider = (): PaymentProvider => (process.env.PAYMENT_PROVIDER === "paypal" ? "paypal" : "koolupi");
