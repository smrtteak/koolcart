import { read } from "@/lib/store";

export async function GET() {
  const db = await read();
  return Response.json({ ...db, orders: db.orders.slice().reverse() });
}
