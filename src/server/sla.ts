import { db } from "@/lib/db";
import type { Priority, Prisma } from "@prisma/client";
import { addBusinessMinutes, businessMinutesBetween, type CalendarLike } from "@/lib/sla-calc";
import { managerIds, notify, teamMemberIds } from "./notify";
import { ticketRef } from "@/lib/utils";

type PolicyWithCal = Prisma.SlaPolicyGetPayload<{ include: { calendar: { include: { holidays: true } } } }>;

export function toCalendar(p: PolicyWithCal | null): CalendarLike | null {
  const c = p?.calendar;
  if (!c) return null;
  return { timezone: c.timezone, workDays: c.workDays, startTime: c.startTime, endTime: c.endTime, is24x7: c.is24x7, holidays: c.holidays.map((h) => h.date) };
}

export async function policyFor(orgId: string, priority: Priority) {
  return db.slaPolicy.findFirst({
    where: { orgId, priority, isActive: true },
    include: { calendar: { include: { holidays: true } } },
  });
}

/** Calcula vencimientos de respuesta/resolución para una prioridad. */
export async function computeSla(orgId: string, priority: Priority, from: Date, pausedMinutes = 0) {
  const policy = await policyFor(orgId, priority);
  if (!policy) return { slaPolicyId: null, responseDueAt: null, resolutionDueAt: null };
  const cal = toCalendar(policy);
  return {
    slaPolicyId: policy.id,
    responseDueAt: addBusinessMinutes(from, policy.responseMinutes, cal),
    resolutionDueAt: addBusinessMinutes(from, policy.resolutionMinutes + pausedMinutes, cal),
  };
}

/** Al salir de "Pendiente": desplaza el vencimiento por el tiempo hábil en pausa. */
export async function resumeSlaData(ticket: { slaPausedAt: Date | null; slaPolicyId: string | null; resolutionDueAt: Date | null; slaPausedMinutes: number }) {
  if (!ticket.slaPausedAt) return {};
  const policy = ticket.slaPolicyId
    ? await db.slaPolicy.findUnique({ where: { id: ticket.slaPolicyId }, include: { calendar: { include: { holidays: true } } } })
    : null;
  const cal = toCalendar(policy);
  const paused = Math.round(businessMinutesBetween(ticket.slaPausedAt, new Date(), cal));
  return {
    slaPausedAt: null,
    slaPausedMinutes: ticket.slaPausedMinutes + paused,
    resolutionDueAt: ticket.resolutionDueAt ? addBusinessMinutes(ticket.resolutionDueAt, paused, cal) : null,
  };
}

const OPEN = ["NEW", "ASSIGNED", "IN_PROGRESS"] as const;

/**
 * Barrido periódico de SLA (cada minuto vía instrumentation.ts o /api/cron/sla):
 * - Alerta al alcanzar el % de advertencia.
 * - Marca incumplimientos y escala jerárquicamente (líderes de equipo → gestores).
 * - Cierra automáticamente tickets resueltos sin respuesta tras 3 días.
 */
export async function runSlaSweep(now = new Date()) {
  const stats = { warned: 0, responseBreached: 0, resolutionBreached: 0, autoClosed: 0 };

  // 1) Advertencias de vencimiento
  const candidates = await db.ticket.findMany({
    where: { status: { in: [...OPEN] }, slaPausedAt: null, slaWarned: false, resolutionDueAt: { gt: now } },
    include: { slaPolicy: true },
    take: 500,
  });
  for (const t of candidates) {
    const total = t.resolutionDueAt!.getTime() - t.createdAt.getTime();
    const used = now.getTime() - t.createdAt.getTime();
    const warn = (t.slaPolicy?.warnPercent ?? 75) / 100;
    if (total > 0 && used / total >= warn) {
      await db.ticket.update({ where: { id: t.id }, data: { slaWarned: true } });
      const to = t.assigneeId ? [t.assigneeId] : await teamMemberIds(t.teamId);
      await notify(t.orgId, to, {
        kind: "warning",
        title: `SLA por vencer: ${ticketRef(t.type, t.number)}`,
        body: t.title,
        link: `/tickets/${t.id}`,
      });
      stats.warned++;
    }
  }

  // 2) Incumplimiento de respuesta
  const respBreach = await db.ticket.findMany({
    where: { status: { in: [...OPEN] }, firstResponseAt: null, responseBreached: false, slaPausedAt: null, responseDueAt: { lt: now } },
    take: 500,
  });
  for (const t of respBreach) {
    await db.ticket.update({ where: { id: t.id }, data: { responseBreached: true } });
    await db.ticketActivity.create({ data: { ticketId: t.id, action: "sla", note: "Se venció el tiempo de primera respuesta" } });
    await notify(t.orgId, [t.assigneeId, ...(await teamMemberIds(t.teamId, true))], {
      kind: "danger", title: `Sin respuesta a tiempo: ${ticketRef(t.type, t.number)}`, body: t.title, link: `/tickets/${t.id}`,
    });
    stats.responseBreached++;
  }

  // 3) Incumplimiento de resolución → escalamiento jerárquico automático
  const resBreach = await db.ticket.findMany({
    where: { status: { in: [...OPEN] }, resolutionBreached: false, slaPausedAt: null, resolutionDueAt: { lt: now } },
    take: 500,
  });
  for (const t of resBreach) {
    await db.ticket.update({ where: { id: t.id }, data: { resolutionBreached: true, escalationLevel: { increment: 1 } } });
    await db.ticketActivity.create({
      data: { ticketId: t.id, action: "escalated", fromValue: String(t.escalationLevel), toValue: String(t.escalationLevel + 1), note: "Escalamiento automático por SLA de resolución vencido" },
    });
    const leads = await teamMemberIds(t.teamId, true);
    const managers = await managerIds(t.orgId);
    await notify(t.orgId, [t.assigneeId, ...leads, ...managers], {
      kind: "danger", title: `SLA vencido y escalado: ${ticketRef(t.type, t.number)}`, body: t.title, link: `/tickets/${t.id}`,
    });
    stats.resolutionBreached++;
  }

  // 4) Cierre automático de resueltos (3 días sin respuesta del usuario)
  const stale = await db.ticket.findMany({
    where: { status: "RESOLVED", resolvedAt: { lt: new Date(now.getTime() - 3 * 86400_000) } },
    select: { id: true },
    take: 500,
  });
  for (const t of stale) {
    await db.ticket.update({ where: { id: t.id }, data: { status: "CLOSED", closedAt: now } });
    await db.ticketActivity.create({ data: { ticketId: t.id, action: "status", fromValue: "RESOLVED", toValue: "CLOSED", note: "Cierre automático tras 3 días resuelto" } });
    stats.autoClosed++;
  }
  return stats;
}

/**
 * Barrido «perezoso» para serverless (Vercel): se dispara con la actividad de los usuarios.
 * Como máximo una vez por minuto en toda la plataforma: el UPDATE condicional en BD
 * garantiza que solo una instancia lo ejecute aunque haya varias en paralelo.
 */
export async function maybeRunSlaSweep(minIntervalMs = 60_000) {
  const g = globalThis as unknown as { __slaLastCheck?: number };
  const now = Date.now();
  if (now - (g.__slaLastCheck ?? 0) < 15_000) return null; // evita consultar la BD en cada request
  g.__slaLastCheck = now;
  await db.jobLock.upsert({ where: { name: "sla-sweep" }, create: { name: "sla-sweep", lastRunAt: new Date(0) }, update: {} });
  const claimed = await db.jobLock.updateMany({
    where: { name: "sla-sweep", lastRunAt: { lt: new Date(now - minIntervalMs) } },
    data: { lastRunAt: new Date(now) },
  });
  if (claimed.count === 0) return null;
  return runSlaSweep();
}
