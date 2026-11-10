// Shoppers have no accounts, so each browser remembers the orders it paid for. The order numbers are random, so
// knowing one is what lets you look it up (like the returns form).
const KEY = "koolcart:my-orders";

export function myOrderIds(): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberOrder(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...myOrderIds().filter((x) => x !== id)].slice(0, 50)));
  } catch {}
}

export function forgetOrder(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(myOrderIds().filter((x) => x !== id)));
  } catch {}
}
