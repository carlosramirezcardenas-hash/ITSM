import { db } from "@/lib/db";
import { getCtx } from "@/server/auth";
import { api } from "@/server/api";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const ctx = await getCtx();
  const items = await db.serviceItem.findMany({
    where: { orgId: ctx.orgId, isActive: true },
    select: { id: true, name: true, description: true, icon: true, estimatedHours: true, requirements: true, requiresApproval: true, formSchema: true, category: { select: { id: true, name: true } } },
    orderBy: [{ popularity: "desc" }, { name: "asc" }],
  });
  return { items };
});
