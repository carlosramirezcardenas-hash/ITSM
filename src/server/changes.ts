import "server-only";
import { z } from "zod";
import type { ChangeStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CHANGE_STATUS_LABEL, CHANGE_TYPE_LABEL, OUTCOME_LABEL } from "@/lib/labels";
export { CHANGE_STATUS_LABEL, CHANGE_TYPE_LABEL, OUTCOME_LABEL };
import { approvalLevels, assessRisk, CHANGE_FLOW, findConflicts, RISK_QUESTIONS } from "@/lib/itsm";
import { type Ctx, assertCan } from "./auth";
import { forbidden, invalid, notFound } from "./errors";
import { managerIds, notify, teamMemberIds } from "./notify";
import { impactAnalysis } from "./cmdb";
import { log } from "./worklog";
import { audit } from "./audit";
import { can } from "@/lib/rbac";


const optId = z.string().optional().nullable().transform((v) => v || null);
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const optDate = z.string().optional().nullable().transform((v, c) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) { c.addIssue({ code: "custom", message: "Fecha inválida." }); return null; }
  return d;
});
const riskAnswers = z.object(Object.fromEntries(RISK_QUESTIONS.map((q) => [q.key, z.boolean().optional()])) as Record<(typeof RISK_QUESTIONS)[number]["key"], z.ZodOptional<z.ZodBoolean>>).default({});

export const changeInput = z.object({
  title: z.string().trim().min(5, "Título demasiado corto.").max(160),
  description: z.string().trim().min(10, "Describe qué se va a cambiar.").max(5000),
  reason: optText(2000),
  type: z.enum(["STANDARD", "NORMAL", "EMERGENCY"]).default("NORMAL"),
  ciIds: z.array(z.string()).max(50).default([]),
  riskAnswers,
  implementationPlan: optText(10000),
  rollbackPlan: optText(10000),
  testPlan: optText(10000),
  plannedStart: optDate,
  plannedEnd: optDate,
  ownerId: optId,
  teamId: optId,
  problemId: optId,
});

const EDITABLE: ChangeStatus[] = ["DRAFT", "ASSESSMENT", "REJECTED"];

async function checkRefs(ctx: Ctx, i: z.infer<typeof changeInput>) {
  if (i.ciIds.length && (await db.configItem.count({ where: { orgId: ctx.orgId, id: { in: i.ciIds } } })) !== i.ciIds.length) throw invalid("Elemento de configuración inválido.");
  if (i.ownerId && !(await db.user.findFirst({ where: { id: i.ownerId, orgId: ctx.orgId, isActive: true, role: { in: ["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"] } } }))) throw invalid("El implementador debe ser parte del equipo de TI.");
  if (i.teamId && !(await db.team.findFirst({ where: { id: i.teamId, orgId: ctx.orgId } }))) throw invalid("Equipo inválido.");
  if (i.problemId && !(await db.problem.findFirst({ where: { id: i.problemId, orgId: ctx.orgId } }))) throw invalid("Problema inválido.");
  if (i.plannedStart && i.plannedEnd && i.plannedEnd <= i.plannedStart) throw invalid("La ventana debe terminar después de comenzar.", { plannedEnd: "Revisa las fechas." });
}

/** Riesgo (cuestionario + servicios críticos afectados según la CMDB) e impacto. */
async function evaluate(ctx: Ctx, i: z.infer<typeof changeInput>) {
  const imp = await impactAnalysis(ctx, i.ciIds);
  const { score, risk } = assessRisk(i.riskAnswers, imp.criticalServices);
  return { risk, riskScore: score, impact: imp.impact };
}

export async function previewChange(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "changes:create");
  const i = changeInput.partial({ title: true, description: true }).parse(raw);
  const imp = await impactAnalysis(ctx, i.ciIds ?? []);
  const { score, risk } = assessRisk(i.riskAnswers ?? {}, imp.criticalServices);
  let conflicts: { id: string; number: number; title: string }[] = [];
  if (i.plannedStart && i.plannedEnd && i.ciIds?.length) conflicts = await conflictsFor(ctx, { id: "", start: i.plannedStart, end: i.plannedEnd, ciIds: i.ciIds });
  return { risk, riskScore: score, impact: imp.impact, services: imp.services.map((s) => ({ id: s.id, name: s.name, criticality: s.criticality })), affected: imp.affected.length, levels: approvalLevels(i.type ?? "NORMAL", risk), conflicts };
}

export async function createChange(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "changes:create");
  const i = changeInput.parse(raw);
  await checkRefs(ctx, i);
  const ev = await evaluate(ctx, i);
  const c = await db.$transaction(async (tx) => {
    const { changeSeq } = await tx.organization.update({ where: { id: ctx.orgId }, data: { changeSeq: { increment: 1 } }, select: { changeSeq: true } });
    const { ciIds, riskAnswers: ra, ...rest } = i;
    const c = await tx.change.create({
      data: { ...rest, ...ev, riskAnswers: ra, orgId: ctx.orgId, number: changeSeq, requesterId: ctx.user.id, ownerId: i.ownerId ?? ctx.user.id, configItems: { connect: ciIds.map((id) => ({ id })) } },
    });
    await log(tx, ctx.orgId, "change", c.id, ctx.user.id, "created");
    return c;
  });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "change.created", entity: "change", entityId: c.id, meta: { type: c.type, risk: c.risk } });
  return c;
}

export async function updateChange(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "changes:create");
  const c = await db.change.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!c) throw notFound();
  if (!EDITABLE.includes(c.status)) throw invalid("Solo se puede editar un cambio en borrador, evaluación o rechazado. Una vez aprobado, el plan queda congelado.");
  const i = changeInput.parse(raw);
  await checkRefs(ctx, i);
  const ev = await evaluate(ctx, i);
  const { ciIds, riskAnswers: ra, ...rest } = i;
  await db.$transaction(async (tx) => {
    await tx.change.update({ where: { id }, data: { ...rest, ...ev, riskAnswers: ra, configItems: { set: ciIds.map((x) => ({ id: x })) }, ...(c.status === "REJECTED" ? { status: "DRAFT" } : {}) } });
    await log(tx, ctx.orgId, "change", id, ctx.user.id, "updated", `Riesgo ${ev.risk}, impacto ${ev.impact}`);
  });
}

async function cabMembers(orgId: string, level: number, exclude: string) {
  const roles = level === 1 ? ["SERVICE_MANAGER"] as const : ["ORG_ADMIN"] as const;
  let users = await db.user.findMany({ where: { orgId, isActive: true, role: { in: [...roles] }, id: { not: exclude } }, select: { id: true } });
  if (!users.length) users = await db.user.findMany({ where: { orgId, isActive: true, role: { in: ["ORG_ADMIN", "SERVICE_MANAGER"] }, id: { not: exclude } }, select: { id: true } });
  return users.map((u) => u.id);
}

async function openApprovalLevel(tx: Prisma.TransactionClient, orgId: string, changeId: string, level: number, requesterId: string) {
  const ids = await cabMembers(orgId, level, requesterId);
  if (!ids.length) throw invalid("No hay aprobadores disponibles para este cambio (CAB). Asigna el rol de gestor a alguien.");
  await tx.changeApproval.createMany({ data: ids.map((approverId) => ({ changeId, approverId, level })) });
  return ids;
}

/** Envía a evaluación y aprobación. Los estándar quedan programados directamente (preaprobados). */
export async function submitChange(ctx: Ctx, id: string) {
  assertCan(ctx, "changes:create");
  const c = await db.change.findFirst({ where: { id, orgId: ctx.orgId }, include: { configItems: { select: { id: true } } } });
  if (!c) throw notFound();
  if (!["DRAFT", "ASSESSMENT"].includes(c.status)) throw invalid("Este cambio ya fue enviado.");
  const missing: Record<string, string> = {};
  if (!c.implementationPlan) missing.implementationPlan = "Requerido.";
  if (!c.rollbackPlan) missing.rollbackPlan = "Requerido.";
  if (!c.plannedStart) missing.plannedStart = "Requerido.";
  if (!c.plannedEnd) missing.plannedEnd = "Requerido.";
  if (c.type !== "EMERGENCY" && !c.configItems.length) missing.ciIds = "Indica al menos un elemento afectado.";
  if (Object.keys(missing).length) throw invalid("Completa el plan de implementación, el plan de reversa, la ventana y los elementos afectados antes de enviar.", missing);
  if (c.type !== "EMERGENCY" && c.plannedStart! < new Date()) throw invalid("La ventana planificada ya pasó. Reprograma el cambio.", { plannedStart: "En el pasado." });

  const levels = approvalLevels(c.type, c.risk);
  if (levels === 0) {
    await db.$transaction(async (tx) => {
      await tx.change.update({ where: { id }, data: { status: "SCHEDULED" } });
      await log(tx, ctx.orgId, "change", id, ctx.user.id, "status:SCHEDULED", "Cambio estándar preaprobado");
    });
    return { status: "SCHEDULED" as const };
  }
  const approvers = await db.$transaction(async (tx) => {
    await tx.change.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
    await tx.changeApproval.deleteMany({ where: { changeId: id, status: "PENDING" } });
    const ids = await openApprovalLevel(tx, ctx.orgId, id, 1, c.requesterId);
    await log(tx, ctx.orgId, "change", id, ctx.user.id, "status:PENDING_APPROVAL", levels === 2 ? "Riesgo alto: requiere CAB y dirección" : c.type === "EMERGENCY" ? "Emergencia: aprobación acelerada (ECAB)" : "Enviado al CAB");
    return ids;
  });
  await notify(ctx.orgId, approvers, { kind: c.type === "EMERGENCY" ? "danger" : "warning", title: `${c.type === "EMERGENCY" ? "Cambio de EMERGENCIA" : "Cambio"} por aprobar: CHG-${c.number}`, body: c.title, link: `/changes/${id}` }, ctx.user.id);
  return { status: "PENDING_APPROVAL" as const };
}

export async function decideChange(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "changes:approve");
  const input = z.object({ approve: z.boolean(), comment: z.string().trim().max(2000).optional() }).parse(raw);
  const c = await db.change.findFirst({ where: { id, orgId: ctx.orgId }, include: { approvals: true } });
  if (!c) throw notFound();
  if (c.status !== "PENDING_APPROVAL") throw invalid("Este cambio no está esperando aprobación.");
  const mine = c.approvals.find((a) => a.approverId === ctx.user.id && a.status === "PENDING");
  if (!mine) throw forbidden("No eres aprobador de este cambio en la etapa actual.");
  if (!input.approve && !input.comment) throw invalid("Indica el motivo del rechazo.", { comment: "Requerido." });
  const levels = approvalLevels(c.type, c.risk);
  const now = new Date();
  let notifyIds: string[] = [];
  let result: "SCHEDULED" | "REJECTED" | "NEXT_LEVEL";
  await db.$transaction(async (tx) => {
    await tx.changeApproval.update({ where: { id: mine.id }, data: { status: input.approve ? "APPROVED" : "REJECTED", comment: input.comment, decidedAt: now } });
    // Basta una decisión por nivel: el resto del nivel queda cerrado
    await tx.changeApproval.updateMany({ where: { changeId: id, level: mine.level, status: "PENDING" }, data: { status: "NOT_REQUIRED", comment: `Decidido por ${ctx.user.name}`, decidedAt: now } });
    if (!input.approve) {
      await tx.change.update({ where: { id }, data: { status: "REJECTED" } });
      result = "REJECTED";
    } else if (mine.level < levels) {
      notifyIds = await openApprovalLevel(tx, ctx.orgId, id, mine.level + 1, c.requesterId);
      result = "NEXT_LEVEL";
    } else {
      await tx.change.update({ where: { id }, data: { status: "SCHEDULED" } });
      result = "SCHEDULED";
    }
    await log(tx, ctx.orgId, "change", id, ctx.user.id, input.approve ? `approved:${mine.level}` : `rejected:${mine.level}`, input.comment ?? null);
  });
  if (result! === "NEXT_LEVEL") await notify(ctx.orgId, notifyIds, { kind: "warning", title: `Cambio de riesgo alto por aprobar (nivel 2): CHG-${c.number}`, body: c.title, link: `/changes/${id}` }, ctx.user.id);
  const msg = result! === "REJECTED" ? { kind: "danger" as const, title: `CHG-${c.number} fue rechazado`, body: input.comment } : result! === "SCHEDULED" ? { kind: "success" as const, title: `CHG-${c.number} aprobado y programado`, body: c.title } : null;
  if (msg) await notify(ctx.orgId, [c.requesterId, c.ownerId], { ...msg, link: `/changes/${id}` }, ctx.user.id);
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: input.approve ? "change.approved" : "change.rejected", entity: "change", entityId: id, meta: { level: mine.level } });
  return result!;
}

function canOperate(ctx: Ctx, c: { ownerId: string | null; requesterId: string }) {
  return c.ownerId === ctx.user.id || c.requesterId === ctx.user.id || can(ctx.user.role, "changes:approve");
}

export async function transitionChange(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "changes:create");
  const input = z.object({
    to: z.enum(["ASSESSMENT", "DRAFT", "IN_PROGRESS", "REVIEW", "CLOSED", "CANCELLED"]),
    outcome: z.enum(["SUCCESSFUL", "PARTIAL", "FAILED", "ROLLED_BACK"]).optional(),
    note: z.string().trim().max(5000).optional(),
  }).parse(raw);
  const c = await db.change.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!c) throw notFound();
  if (!canOperate(ctx, c)) throw forbidden("Solo el implementador, el solicitante o el CAB pueden operar este cambio.");
  if (!CHANGE_FLOW[c.status]!.includes(input.to)) throw invalid(`No se puede pasar de «${CHANGE_STATUS_LABEL[c.status]}» a «${CHANGE_STATUS_LABEL[input.to]}».`);
  const data: Prisma.ChangeUncheckedUpdateInput = { status: input.to };
  const now = new Date();
  if (input.to === "IN_PROGRESS") data.actualStart = now;
  if (input.to === "REVIEW") {
    if (!input.outcome) throw invalid("Indica el resultado de la implementación.", { outcome: "Requerido." });
    if (input.outcome !== "SUCCESSFUL" && !input.note) throw invalid("Describe qué ocurrió.", { note: "Requerido si no fue exitoso." });
    data.actualEnd = now;
    data.outcome = input.outcome;
  }
  if (input.to === "CLOSED") {
    if (!input.note || input.note.length < 5) throw invalid("Registra la validación posterior a la implementación.", { note: "Requerido." });
    if (!can(ctx.user.role, "changes:approve") && c.ownerId === ctx.user.id && c.requesterId === ctx.user.id) throw forbidden("La revisión post-implementación debe hacerla el CAB o el solicitante.");
    data.reviewNotes = input.note;
  }
  if (input.to === "CANCELLED" && !input.note) throw invalid("Indica el motivo de la cancelación.", { note: "Requerido." });
  await db.$transaction(async (tx) => {
    await tx.change.update({ where: { id }, data });
    if (input.to === "CANCELLED") await tx.changeApproval.updateMany({ where: { changeId: id, status: "PENDING" }, data: { status: "NOT_REQUIRED" } });
    await log(tx, ctx.orgId, "change", id, ctx.user.id, `status:${input.to}`, [input.outcome ? OUTCOME_LABEL[input.outcome] : null, input.note].filter(Boolean).join(" — ") || null);
  });
  if (input.to === "REVIEW" && input.outcome && input.outcome !== "SUCCESSFUL") {
    await notify(ctx.orgId, [...(await managerIds(ctx.orgId)), c.requesterId], { kind: "danger", title: `CHG-${c.number}: resultado ${OUTCOME_LABEL[input.outcome]}`, body: input.note, link: `/changes/${id}` }, ctx.user.id);
  }
  if (input.to === "IN_PROGRESS") await notify(ctx.orgId, await teamMemberIds(c.teamId), { kind: "info", title: `Comenzó la implementación de CHG-${c.number}`, body: c.title, link: `/changes/${id}` }, ctx.user.id);
}

// ---------------------------------------------------- Consulta
export async function listChanges(ctx: Ctx, f: { status?: string; type?: string; q?: string }) {
  assertCan(ctx, "changes:create");
  const where: Prisma.ChangeWhereInput = { orgId: ctx.orgId };
  if (!f.status || f.status === "active") where.status = { in: ["DRAFT", "ASSESSMENT", "PENDING_APPROVAL", "SCHEDULED", "IN_PROGRESS", "REVIEW"] };
  else if (f.status === "mine_approval") where.approvals = { some: { approverId: ctx.user.id, status: "PENDING" } };
  else if (f.status !== "any" && f.status in CHANGE_STATUS_LABEL) where.status = f.status as ChangeStatus;
  if (f.type && f.type in CHANGE_TYPE_LABEL) where.type = f.type as "NORMAL";
  if (f.q) {
    const n = Number(f.q.replace(/^chg-/i, ""));
    where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : [])];
  }
  return db.change.findMany({ where, include: { owner: { select: { name: true } }, _count: { select: { configItems: true } } }, orderBy: [{ plannedStart: { sort: "asc", nulls: "last" } }], take: 200 });
}

export async function getChange(ctx: Ctx, id: string) {
  assertCan(ctx, "changes:create");
  const c = await db.change.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      requester: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } }, team: { select: { id: true, name: true } },
      problem: { select: { id: true, number: true, title: true } },
      configItems: { select: { id: true, name: true, type: true, criticality: true } },
      approvals: { include: { approver: { select: { id: true, name: true } } }, orderBy: [{ level: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!c) throw notFound("Este cambio no existe o no pertenece a tu organización.");
  const imp = await impactAnalysis(ctx, c.configItems.map((x) => x.id));
  const conflicts = c.plannedStart && c.plannedEnd && !["CLOSED", "CANCELLED", "REJECTED"].includes(c.status)
    ? await conflictsFor(ctx, { id: c.id, start: c.plannedStart, end: c.plannedEnd, ciIds: c.configItems.map((x) => x.id) }) : [];
  return { ...c, services: imp.services, affectedCount: imp.affected.length, conflicts, canOperate: canOperate(ctx, c) };
}

export async function conflictsFor(ctx: Ctx, w: { id: string; start: Date; end: Date; ciIds: string[] }) {
  const others = await db.change.findMany({
    where: { orgId: ctx.orgId, id: { not: w.id || undefined }, status: { in: ["PENDING_APPROVAL", "SCHEDULED", "IN_PROGRESS"] }, plannedStart: { lt: w.end }, plannedEnd: { gt: w.start } },
    select: { id: true, number: true, title: true, plannedStart: true, plannedEnd: true, configItems: { select: { id: true } } },
  });
  const hits = findConflicts(w, others.map((o) => ({ id: o.id, start: o.plannedStart!, end: o.plannedEnd!, ciIds: o.configItems.map((c) => c.id) })));
  return others.filter((o) => hits.some((h) => h.id === o.id)).map(({ id, number, title }) => ({ id, number, title }));
}

/** Calendario mensual de cambios (por ventana planificada). */
export async function changeCalendar(ctx: Ctx, month: string) {
  assertCan(ctx, "changes:create");
  const m = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const start = new Date(`${m}-01T00:00:00Z`);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  const items = await db.change.findMany({
    where: { orgId: ctx.orgId, status: { notIn: ["CANCELLED", "DRAFT"] }, plannedStart: { lt: new Date(end.getTime() + 86400_000) }, plannedEnd: { gt: new Date(start.getTime() - 86400_000) } },
    select: { id: true, number: true, title: true, type: true, status: true, risk: true, plannedStart: true, plannedEnd: true, outcome: true, configItems: { select: { id: true } } },
    orderBy: { plannedStart: "asc" },
  });
  const windows = items.map((i) => ({ id: i.id, start: i.plannedStart!, end: i.plannedEnd!, ciIds: i.configItems.map((c) => c.id) }));
  const active = (s: string) => ["PENDING_APPROVAL", "SCHEDULED", "IN_PROGRESS"].includes(s);
  return {
    month: m,
    items: items.map(({ configItems: _c, ...i }) => ({ ...i, conflict: active(i.status) && findConflicts(windows.find((w) => w.id === i.id)!, windows.filter((w) => active(items.find((x) => x.id === w.id)!.status))).length > 0 })),
  };
}

export async function pendingChangeApprovals(ctx: Ctx) {
  return db.changeApproval.findMany({
    where: { approverId: ctx.user.id, status: "PENDING", change: { orgId: ctx.orgId, status: "PENDING_APPROVAL" } },
    include: { change: { select: { id: true, number: true, title: true, type: true, risk: true, impact: true, plannedStart: true, plannedEnd: true, requester: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
}
