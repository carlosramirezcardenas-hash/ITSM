import { db } from "@/lib/db";
import { getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Notificaciones en tiempo real con Server-Sent Events.
 * MVP: sondeo liviano a la BD cada 4 s por conexión. Para escalar: Postgres LISTEN/NOTIFY o Redis Pub/Sub.
 */
export async function GET(req: Request) {
  const u = await getSessionUser();
  if (!u) return new Response("No autenticado", { status: 401 });
  const enc = new TextEncoder();
  let since = new Date();
  let timer: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("ready", { ok: true });
      timer = setInterval(async () => {
        try {
          const fresh = await db.notification.findMany({ where: { userId: u.id, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, take: 10 });
          for (const n of fresh) { send("notification", n); since = n.createdAt; }
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch { clearInterval(timer); try { controller.close(); } catch {} }
      }, 4000);
      req.signal.addEventListener("abort", () => { clearInterval(timer); try { controller.close(); } catch {} });
    },
    cancel() { clearInterval(timer); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
