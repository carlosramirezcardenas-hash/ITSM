import { getCtx } from "@/server/auth";
import { api } from "@/server/api";
import { getMetrics } from "@/server/metrics";

export const dynamic = "force-dynamic";

/** GET /api/v1/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&teamId=&categoryId=&assigneeId=&type= */
export const GET = api(async (req: Request) => getMetrics(await getCtx("reports:view"), Object.fromEntries(new URL(req.url).searchParams)));
