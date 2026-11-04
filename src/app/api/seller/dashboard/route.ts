import { sellerGuard } from "@/lib/http";
import { read } from "@/lib/store";

export async function GET(req: Request) {
  const denied = sellerGuard(req);
  if (denied) return denied;
  const db = await read();
  return Response.json({ ...db, orders: db.orders.slice().reverse() });
}
