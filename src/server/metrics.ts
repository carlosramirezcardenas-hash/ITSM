import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "./auth";

export const metricsFilters = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  teamId: z.string().optional(),
  categoryId: z.string().optional(),
  assigneeId: z.string().optional(),
  type: z.enum(["INCIDENT", "REQUEST"]).optional(),
});
export type MetricsFilters = z.infer<typeof metricsFilters>;

const OPEN = ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] as const;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

export async function getMetrics(ctx: Ctx, raw: unknown) {
  const f = metricsFilters.parse(raw ?? {});
  const to = f.to ? new Date(`${f.to}T23:59:59.999Z`) : new Date();
  const from = f.from ? new Date(`${f.from}T00:00:00Z`) : new Date(to.getTime() - 29 * 86400_000);
  const scope: Prisma.TicketWhereInput = { orgId: ctx.orgId };
  if (f.teamId) scope.teamId = f.teamId;
  if (f.categoryId) scope.categoryId = f.categoryId;
  if (f.assigneeId) scope.assigneeId = f.assigneeId;
  if (f.type) scope.type = f.type;

  const select = {
    id: true, type: true, status: true, priority: true, createdAt: true, resolvedAt: true, firstResponseAt: true,
    resolutionBreached: true, responseBreached: true, resolutionDueAt: true, csatScore: true, assigneeId: true, teamId: true,
    categoryId: true, reopenCount: true, slaPolicyId: true,
  } as const;

  const [inRange, open, users, teams, categories] = await Promise.all([
    db.ticket.findMany({ where: { ...scope, createdAt: { gte: from, lte: to } }, select }),
    db.ticket.findMany({ where: { ...scope, status: { in: [...OPEN] } }, select: { ...select, slaWarned: true, approvalStatus: true } }),
    db.user.findMany({ where: { orgId: ctx.orgId, role: { in: ["AGENT", "SERVICE_MANAGER"] }, isActive: true }, select: { id: true, name: true } }),
    db.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
    db.category.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
  ]);
  const resolvedInRange = await db.ticket.findMany({ where: { ...scope, resolvedAt: { gte: from, lte: to } }, select });

  const withSla = resolvedInRange.filter((t) => t.slaPolicyId);
  const slaMet = withSla.filter((t) => !t.resolutionBreached).length;
  const responded = inRange.filter((t) => t.firstResponseAt);
  const responseWithSla = inRange.filter((t) => t.slaPolicyId && (t.firstResponseAt || t.responseBreached));
  const csat = inRange.filter((t) => t.csatScore != null).map((t) => t.csatScore!);
  const now = Date.now();

  // Tendencia: diaria si el rango ≤ 45 días, si no mensual
  const days = Math.ceil((to.getTime() - from.getTime()) / 86400_000);
  const monthly = days > 45;
  const key = (d: Date) => (monthly ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10));
  const buckets = new Map<string, { label: string; creados: number; resueltos: number }>();
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + (monthly ? 28 : 1) * 86400_000)) {
    const k = key(d);
    if (!buckets.has(k)) buckets.set(k, { label: monthly ? k : k.slice(5), creados: 0, resueltos: 0 });
  }
  for (const t of inRange) buckets.get(key(t.createdAt)) && buckets.get(key(t.createdAt))!.creados++;
  for (const t of resolvedInRange) buckets.get(key(t.resolvedAt!)) && buckets.get(key(t.resolvedAt!))!.resueltos++;

  const byPriority = (["P1", "P2", "P3", "P4"] as const).map((p) => ({ priority: p, count: open.filter((t) => t.priority === p).length }));

  const workload = users.map((u) => ({
    id: u.id,
    name: u.name,
    open: open.filter((t) => t.assigneeId === u.id).length,
    resolved: resolvedInRange.filter((t) => t.assigneeId === u.id).length,
    breached: open.filter((t) => t.assigneeId === u.id && t.resolutionBreached).length,
  })).sort((a, b) => b.open - a.open);

  const complianceBy = (items: { id: string; name: string }[], keyOf: (t: (typeof resolvedInRange)[number]) => string | null) =>
    items.map((it) => {
      const set = withSla.filter((t) => keyOf(t) === it.id);
      return { id: it.id, name: it.name, total: set.length, compliance: pct(set.filter((t) => !t.resolutionBreached).length, set.length) };
    }).filter((x) => x.total > 0);

  // Incidentes recurrentes: categorías con más incidentes en el período
  const recurring = categories.map((c) => ({
    id: c.id, name: c.name,
    count: inRange.filter((t) => t.type === "INCIDENT" && t.categoryId === c.id).length,
    reopened: inRange.filter((t) => t.categoryId === c.id && t.reopenCount > 0).length,
  })).filter((c) => c.count > 0).sort((a, b) => b.count - a.count).slice(0, 6);

  const alerts: { kind: "danger" | "warning" | "info"; text: string }[] = [];
  const breachedOpen = open.filter((t) => t.resolutionBreached).length;
  const p1Open = open.filter((t) => t.priority === "P1").length;
  const unassigned = open.filter((t) => !t.assigneeId && t.approvalStatus !== "PENDING").length;
  if (p1Open) alerts.push({ kind: "danger", text: `${p1Open} incidente(s) crítico(s) abiertos` });
  if (breachedOpen) alerts.push({ kind: "danger", text: `${breachedOpen} ticket(s) con SLA vencido` });
  const warning = open.filter((t) => t.slaWarned && !t.resolutionBreached).length;
  if (warning) alerts.push({ kind: "warning", text: `${warning} ticket(s) por vencer su SLA` });
  if (unassigned) alerts.push({ kind: "info", text: `${unassigned} ticket(s) sin responsable` });
  if (recurring[0] && recurring[0].count >= 5) alerts.push({ kind: "warning", text: `Tendencia: ${recurring[0].count} incidentes en «${recurring[0].name}». Podría existir un problema de fondo.` });

  return {
    range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    kpis: {
      openIncidents: open.filter((t) => t.type === "INCIDENT").length,
      pendingRequests: open.filter((t) => t.type === "REQUEST").length,
      awaitingApproval: open.filter((t) => t.approvalStatus === "PENDING").length,
      created: inRange.length,
      resolved: resolvedInRange.length,
      slaCompliance: pct(slaMet, withSla.length),
      responseCompliance: pct(responseWithSla.filter((t) => !t.responseBreached).length, responseWithSla.length),
      mttrMinutes: avg(resolvedInRange.map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 60000)),
      mttaMinutes: avg(responded.map((t) => (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 60000)),
      csat: avg(csat),
      csatResponses: csat.length,
      csatPositive: pct(csat.filter((s) => s >= 4).length, csat.length),
      breachedOpen,
      overdueNow: open.filter((t) => t.resolutionDueAt && t.resolutionDueAt.getTime() < now).length,
      reopened: inRange.filter((t) => t.reopenCount > 0).length,
    },
    byPriority,
    trend: [...buckets.values()],
    workload,
    complianceByTeam: complianceBy(teams, (t) => t.teamId),
    complianceByCategory: complianceBy(categories, (t) => t.categoryId),
    recurring,
    alerts,
    options: { users, teams, categories },
  };
}

/** Indicadores personales del agente. */
export async function agentStats(ctx: Ctx) {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [open, resolved, csat] = await Promise.all([
    db.ticket.count({ where: { orgId: ctx.orgId, assigneeId: ctx.user.id, status: { in: [...OPEN] } } }),
    db.ticket.findMany({ where: { orgId: ctx.orgId, assigneeId: ctx.user.id, resolvedAt: { gte: since } }, select: { createdAt: true, resolvedAt: true, resolutionBreached: true, slaPolicyId: true } }),
    db.ticket.aggregate({ where: { orgId: ctx.orgId, assigneeId: ctx.user.id, csatScore: { not: null }, updatedAt: { gte: since } }, _avg: { csatScore: true }, _count: { csatScore: true } }),
  ]);
  const withSla = resolved.filter((r) => r.slaPolicyId);
  return {
    open,
    resolved30: resolved.length,
    sla: pct(withSla.filter((r) => !r.resolutionBreached).length, withSla.length),
    mttr: avg(resolved.map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 60000)),
    csat: csat._avg.csatScore,
    csatCount: csat._count.csatScore,
  };
}
