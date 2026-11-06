import { db } from "@/lib/db";
import { getCtx } from "@/server/auth";
import { api } from "@/server/api";
import { metricsFilters } from "@/server/metrics";
import { audit } from "@/server/audit";
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/labels";
import { ticketRef } from "@/lib/utils";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // evita inyección de fórmulas en Excel
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const GET = api(async (req: Request) => {
  const ctx = await getCtx("reports:view");
  const f = metricsFilters.parse(Object.fromEntries(new URL(req.url).searchParams));
  const to = f.to ? new Date(`${f.to}T23:59:59.999Z`) : new Date();
  const from = f.from ? new Date(`${f.from}T00:00:00Z`) : new Date(to.getTime() - 29 * 86400_000);
  const rows = await db.ticket.findMany({
    where: { orgId: ctx.orgId, createdAt: { gte: from, lte: to }, ...(f.teamId ? { teamId: f.teamId } : {}), ...(f.categoryId ? { categoryId: f.categoryId } : {}), ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}), ...(f.type ? { type: f.type } : {}) },
    include: { requester: { select: { name: true } }, assignee: { select: { name: true } }, team: { select: { name: true } }, category: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: 20000,
  });
  const header = ["Número", "Tipo", "Título", "Estado", "Prioridad", "Categoría", "Equipo", "Responsable", "Solicitante", "Creado", "Primera respuesta", "Resuelto", "SLA respuesta vencido", "SLA resolución vencido", "CSAT"];
  const lines = [header.join(",")];
  for (const t of rows) lines.push([
    ticketRef(t.type, t.number), TYPE_LABEL[t.type], t.title, STATUS_LABEL[t.status], PRIORITY_LABEL[t.priority], t.category?.name, t.team?.name, t.assignee?.name, t.requester.name,
    t.createdAt.toISOString(), t.firstResponseAt?.toISOString(), t.resolvedAt?.toISOString(), t.responseBreached ? "Sí" : "No", t.resolutionBreached ? "Sí" : "No", t.csatScore,
  ].map(esc).join(","));
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "report.exported", entity: "report", meta: { rows: rows.length, ...f } });
  return new Response("﻿" + lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tickets-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"` },
  });
});
