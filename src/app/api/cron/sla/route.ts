import { safeEqual } from "@/lib/crypto";
import { runSlaSweep } from "@/server/sla";
export const dynamic = "force-dynamic";
/** Para despliegues serverless: invocar cada minuto con `Authorization: Bearer $CRON_SECRET`. */
async function handler(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!process.env.CRON_SECRET || !safeEqual(token, process.env.CRON_SECRET)) return Response.json({ error: "No autorizado" }, { status: 401 });
  return Response.json(await runSlaSweep());
}

export const GET = handler;  // Vercel Cron envía GET con Authorization: Bearer $CRON_SECRET
export const POST = handler;
