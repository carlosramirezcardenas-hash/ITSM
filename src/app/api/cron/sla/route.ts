import { safeEqual } from "@/lib/crypto";
import { runSlaSweep } from "@/server/sla";
export const dynamic = "force-dynamic";
/** Para despliegues serverless: invocar cada minuto con `Authorization: Bearer $CRON_SECRET`. */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!process.env.CRON_SECRET || !safeEqual(token, process.env.CRON_SECRET)) return Response.json({ error: "No autorizado" }, { status: 401 });
  return Response.json(await runSlaSweep());
}
