import { safeEqual } from "@/lib/crypto";
import { runSlaSweep } from "@/server/sla";
import { purgeInteractions } from "@/server/learning";
export const dynamic = "force-dynamic";
/** Para despliegues serverless: invocar cada minuto con `Authorization: Bearer $CRON_SECRET`. */
async function handler(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!process.env.CRON_SECRET || !safeEqual(token, process.env.CRON_SECRET)) return Response.json({ error: "No autorizado" }, { status: 401 });
  const sla = await runSlaSweep();
  // Retención de conversaciones del asistente. Los casos nuevos se aprenden al resolverse; importar el historial
  // es una decisión del administrador («Aprender del historial»), para revisar antes datos antiguos.
  const purged = await purgeInteractions().catch(() => 0);
  return Response.json({ ...sla, assistantPurged: purged });
}

export const GET = handler;  // Vercel Cron envía GET con Authorization: Bearer $CRON_SECRET
export const POST = handler;
