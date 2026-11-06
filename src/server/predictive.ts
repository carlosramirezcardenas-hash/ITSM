import "server-only";
import { db } from "@/lib/db";
import { breachRisk, forecastDaily } from "@/lib/predict";
import type { Ctx } from "./auth";

const OPEN = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] as const;

/** Pronóstico de tickets para los próximos 7 días y dotación sugerida. */
export async function ticketForecast(ctx: Ctx) {
  const since = new Date(Date.now() - 35 * 86400_000);
  const rows = await db.ticket.findMany({ where: { orgId: ctx.orgId, createdAt: { gte: since } }, select: { createdAt: true } });
  const counts = new Map<string, number>();
  for (const r of rows) { const k = r.createdAt.toISOString().slice(0, 10); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const history = [...counts.entries()].map(([date, count]) => ({ date, count }));
  const { trend, forecast } = forecastDaily(history, 7);
  // Capacidad observada: el máximo de tickets resueltos en un día durante los últimos 30 días
  const resolvedRows = await db.ticket.findMany({ where: { orgId: ctx.orgId, resolvedAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, select: { resolvedAt: true } });
  const perDay = new Map<string, number>();
  for (const r of resolvedRows) { const k = r.resolvedAt!.toISOString().slice(0, 10); perDay.set(k, (perDay.get(k) ?? 0) + 1); }
  const capacity = Math.max(0, ...perDay.values());
  const peak = Math.max(0, ...forecast.map((f) => f.expected));
  return { trend, forecast, total: Math.round(forecast.reduce((a, f) => a + f.expected, 0)), peak, capacity, overCapacity: capacity > 0 && peak > capacity };
}

/** Tickets abiertos ordenados por riesgo de incumplir el SLA. */
export async function riskRanking(ctx: Ctx, opts: { assigneeId?: string; teamIds?: string[]; take?: number } = {}) {
  const open = await db.ticket.findMany({
    where: {
      orgId: ctx.orgId, status: { in: [...OPEN] }, approvalStatus: { not: "PENDING" },
      ...(opts.assigneeId || opts.teamIds ? { OR: [...(opts.assigneeId ? [{ assigneeId: opts.assigneeId }] : []), ...(opts.teamIds?.length ? [{ teamId: { in: opts.teamIds } }] : [])] } : {}),
    },
    select: { id: true, number: true, type: true, title: true, status: true, priority: true, createdAt: true, resolutionDueAt: true, slaPausedAt: true, assigneeId: true, reopenCount: true, assignee: { select: { name: true } } },
  });
  const loads = await db.ticket.groupBy({ by: ["assigneeId"], where: { orgId: ctx.orgId, status: { in: [...OPEN] }, assigneeId: { not: null } }, _count: { _all: true } });
  const load = new Map(loads.map((l) => [l.assigneeId, l._count._all]));
  return open
    .map((t) => ({ ...t, risk: breachRisk({ ...t, assigneeOpenLoad: t.assigneeId ? load.get(t.assigneeId) ?? 0 : 0 }) }))
    .filter((t) => ["high", "medium", "breached"].includes(t.risk.level))
    .sort((a, b) => b.risk.score - a.risk.score)
    .slice(0, opts.take ?? 10);
}
