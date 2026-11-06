import "server-only";
import { z } from "zod";
import type { Prisma, ProblemStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { PROBLEM_STATUS_LABEL } from "@/lib/labels";
export { PROBLEM_STATUS_LABEL };
import { priorityMatrix } from "@/lib/classify";
import { PROBLEM_FLOW } from "@/lib/itsm";
import { slugify, ticketRef } from "@/lib/utils";
import { type Ctx, assertCan } from "./auth";
import { invalid, notFound } from "./errors";
import { notify, teamMemberIds } from "./notify";
import { log } from "./worklog";
import { audit } from "./audit";
import { after } from "next/server";


const level = z.enum(["LOW", "MEDIUM", "HIGH"]);
const optId = z.string().optional().nullable().transform((v) => v || null);

export const problemInput = z.object({
  title: z.string().trim().min(5, "Describe el problema (mín. 5 caracteres).").max(160),
  description: z.string().trim().max(5000).default(""),
  impact: level.default("MEDIUM"),
  urgency: level.default("MEDIUM"),
  categoryId: optId,
  teamId: optId,
  ownerId: optId,
  incidentIds: z.array(z.string()).max(200).default([]),
  ciIds: z.array(z.string()).max(50).default([]),
});

async function checkRefs(ctx: Ctx, r: { categoryId?: string | null; teamId?: string | null; ownerId?: string | null; ciIds?: string[] }) {
  if (r.categoryId && !(await db.category.findFirst({ where: { id: r.categoryId, orgId: ctx.orgId } }))) throw invalid("Categoría inválida.");
  if (r.teamId && !(await db.team.findFirst({ where: { id: r.teamId, orgId: ctx.orgId } }))) throw invalid("Equipo inválido.");
  if (r.ownerId) {
    const u = await db.user.findFirst({ where: { id: r.ownerId, orgId: ctx.orgId, isActive: true, role: { in: ["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"] } } });
    if (!u) throw invalid("El responsable debe ser parte del equipo de TI.");
  }
  if (r.ciIds?.length && (await db.configItem.count({ where: { orgId: ctx.orgId, id: { in: r.ciIds } } })) !== r.ciIds.length) throw invalid("Elemento de configuración inválido.");
}

export async function createProblem(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "problems:manage");
  const input = problemInput.parse(raw);
  await checkRefs(ctx, input);
  const incidents = await db.ticket.findMany({ where: { orgId: ctx.orgId, id: { in: input.incidentIds }, type: "INCIDENT" }, select: { id: true } });
  const p = await db.$transaction(async (tx) => {
    const { problemSeq } = await tx.organization.update({ where: { id: ctx.orgId }, data: { problemSeq: { increment: 1 } }, select: { problemSeq: true } });
    const p = await tx.problem.create({
      data: {
        orgId: ctx.orgId, number: problemSeq, title: input.title, description: input.description,
        impact: input.impact, urgency: input.urgency, priority: priorityMatrix(input.impact, input.urgency),
        categoryId: input.categoryId, teamId: input.teamId, ownerId: input.ownerId ?? ctx.user.id, createdById: ctx.user.id,
        configItems: { connect: input.ciIds.map((id) => ({ id })) },
      },
    });
    if (incidents.length) await tx.ticket.updateMany({ where: { id: { in: incidents.map((i) => i.id) } }, data: { problemId: p.id } });
    await log(tx, ctx.orgId, "problem", p.id, ctx.user.id, "created", incidents.length ? `Con ${incidents.length} incidente(s) vinculados` : null);
    return p;
  });
  if (p.ownerId && p.ownerId !== ctx.user.id) await notify(ctx.orgId, [p.ownerId], { title: `Eres responsable del problema PRB-${p.number}`, body: p.title, link: `/problems/${p.id}` });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "problem.created", entity: "problem", entityId: p.id });
  return p;
}

export async function listProblems(ctx: Ctx, f: { status?: string; q?: string }) {
  assertCan(ctx, "problems:manage");
  const where: Prisma.ProblemWhereInput = { orgId: ctx.orgId };
  if (f.status === "open" || !f.status) where.status = { in: ["NEW", "INVESTIGATING", "KNOWN_ERROR"] };
  else if (f.status !== "any" && f.status in PROBLEM_STATUS_LABEL) where.status = f.status as ProblemStatus;
  if (f.q) {
    const n = Number(f.q.replace(/^prb-/i, ""));
    where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, { rootCause: { contains: f.q, mode: "insensitive" } }, ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : [])];
  }
  return db.problem.findMany({
    where,
    include: { owner: { select: { name: true } }, category: { select: { name: true } }, _count: { select: { incidents: true, tasks: true, changes: true } } },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function getProblem(ctx: Ctx, id: string) {
  assertCan(ctx, "problems:manage");
  const p = await db.problem.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      owner: { select: { id: true, name: true } }, createdBy: { select: { name: true } }, category: true, team: true,
      incidents: { select: { id: true, number: true, type: true, title: true, status: true, priority: true, createdAt: true, requester: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      tasks: { include: { owner: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      changes: { select: { id: true, number: true, title: true, status: true, type: true, outcome: true } },
      configItems: { select: { id: true, name: true, type: true } },
      articles: { select: { id: true, slug: true, title: true, status: true } },
    },
  });
  if (!p) throw notFound("Este problema no existe o no pertenece a tu organización.");
  return p;
}

export const problemUpdate = z.object({
  status: z.enum(["NEW", "INVESTIGATING", "KNOWN_ERROR", "RESOLVED", "CLOSED"]).optional(),
  title: z.string().trim().min(5).max(160).optional(),
  description: z.string().trim().max(5000).optional(),
  impact: level.optional(),
  urgency: level.optional(),
  categoryId: optId.optional(),
  teamId: optId.optional(),
  ownerId: optId.optional(),
  rcaMethod: z.enum(["five_whys", "ishikawa", "timeline", "other"]).optional().nullable(),
  rootCause: z.string().trim().max(10000).optional().nullable(),
  workaround: z.string().trim().max(10000).optional().nullable(),
  permanentFix: z.string().trim().max(10000).optional().nullable(),
  ciIds: z.array(z.string()).max(50).optional(),
});

export async function updateProblem(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "problems:manage");
  const input = problemUpdate.parse(raw);
  const p = await db.problem.findFirst({ where: { id, orgId: ctx.orgId }, include: { tasks: true } });
  if (!p) throw notFound();
  if (p.status === "CLOSED") throw invalid("El problema está cerrado.");
  await checkRefs(ctx, { categoryId: input.categoryId, teamId: input.teamId, ownerId: input.ownerId, ciIds: input.ciIds });

  const { ciIds, status, ...fields } = input;
  const data: Prisma.ProblemUncheckedUpdateInput = { ...fields };
  const merged = { rootCause: input.rootCause ?? p.rootCause, workaround: input.workaround ?? p.workaround, permanentFix: input.permanentFix ?? p.permanentFix };
  const logs: [string, string | null][] = [];
  if (input.impact || input.urgency) data.priority = priorityMatrix(input.impact ?? p.impact, input.urgency ?? p.urgency);
  if (status && status !== p.status) {
    if (!PROBLEM_FLOW[p.status]!.includes(status)) throw invalid(`No se puede pasar de «${PROBLEM_STATUS_LABEL[p.status]}» a «${PROBLEM_STATUS_LABEL[status]}».`);
    const now = new Date();
    if (status === "KNOWN_ERROR") {
      if (!merged.rootCause?.trim()) throw invalid("Para registrar un error conocido, documenta la causa raíz.", { rootCause: "Requerido." });
      if (!merged.workaround?.trim()) throw invalid("Para registrar un error conocido, documenta la solución temporal.", { workaround: "Requerido." });
      data.knownErrorAt = now;
    }
    if (status === "RESOLVED") {
      if (!merged.rootCause?.trim()) throw invalid("Documenta la causa raíz antes de resolver.", { rootCause: "Requerido." });
      if (!merged.permanentFix?.trim()) throw invalid("Describe la solución definitiva aplicada.", { permanentFix: "Requerido." });
      data.resolvedAt = now;
    }
    if (status === "CLOSED") {
      const pending = p.tasks.filter((t) => !t.doneAt).length;
      if (pending && p.status !== "NEW") throw invalid(`Hay ${pending} acción(es) pendientes en el plan. Complétalas antes de cerrar.`);
      data.closedAt = now;
    }
    if (status === "INVESTIGATING" && p.status === "RESOLVED") data.resolvedAt = null;
    data.status = status;
    logs.push([`status:${status}`, null]);
  }
  for (const k of ["rootCause", "workaround", "permanentFix"] as const) if (input[k] !== undefined && input[k] !== p[k]) logs.push([`field:${k}`, null]);
  if (input.ownerId !== undefined && input.ownerId !== p.ownerId) logs.push(["owner", null]);

  await db.$transaction(async (tx) => {
    await tx.problem.update({ where: { id }, data: { ...data, ...(ciIds ? { configItems: { set: ciIds.map((c) => ({ id: c })) } } : {}) } });
    for (const [a, n] of logs) await log(tx, ctx.orgId, "problem", id, ctx.user.id, a, n);
  });
  if (input.ownerId && input.ownerId !== p.ownerId && input.ownerId !== ctx.user.id) {
    await notify(ctx.orgId, [input.ownerId], { title: `Eres responsable del problema PRB-${p.number}`, body: p.title, link: `/problems/${id}` });
  }
  if (status === "KNOWN_ERROR") {
    after(async () => { const { dispatch } = await import("./integrations"); await dispatch(ctx.orgId, "problem.known_error", { title: `PRB-${p.number} · ${p.title}`, text: "Hay una solución temporal disponible.", link: `/problems/${id}` }).catch(() => {}); });
    await notify(ctx.orgId, await teamMemberIds(p.teamId), { kind: "info", title: `Error conocido PRB-${p.number}: hay solución temporal`, body: p.title, link: `/problems/${id}` }, ctx.user.id);
  }
}

/** Vincula incidentes por número (INC-1042, 1042) o id. */
export async function linkIncidents(ctx: Ctx, id: string, refs: string[]) {
  assertCan(ctx, "problems:manage");
  const p = await db.problem.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!p) throw notFound();
  const numbers = refs.map((r) => Number(r.trim().replace(/^inc-/i, ""))).filter((n) => Number.isInteger(n) && n > 0);
  const found = await db.ticket.findMany({ where: { orgId: ctx.orgId, type: "INCIDENT", OR: [{ number: { in: numbers } }, { id: { in: refs } }] }, select: { id: true, number: true } });
  if (!found.length) throw invalid("No encontramos incidentes con esos números.");
  await db.$transaction(async (tx) => {
    await tx.ticket.updateMany({ where: { id: { in: found.map((f) => f.id) } }, data: { problemId: id } });
    await log(tx, ctx.orgId, "problem", id, ctx.user.id, "incidents_linked", found.map((f) => `INC-${f.number}`).join(", "));
  });
  return found.length;
}

export async function unlinkIncident(ctx: Ctx, problemId: string, ticketId: string) {
  assertCan(ctx, "problems:manage");
  const t = await db.ticket.findFirst({ where: { id: ticketId, orgId: ctx.orgId, problemId } });
  if (!t) throw notFound();
  await db.ticket.update({ where: { id: ticketId }, data: { problemId: null } });
  await log(db, ctx.orgId, "problem", problemId, ctx.user.id, "incident_unlinked", `INC-${t.number}`);
}

// ---------------------------------------------------- Plan de acción
export async function addTask(ctx: Ctx, problemId: string, raw: unknown) {
  assertCan(ctx, "problems:manage");
  const input = z.object({ title: z.string().trim().min(3, "Describe la acción.").max(200), ownerId: optId, dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("")).transform((v) => v || null) }).parse(raw);
  const p = await db.problem.findFirst({ where: { id: problemId, orgId: ctx.orgId } });
  if (!p) throw notFound();
  if (input.ownerId && !(await db.user.findFirst({ where: { id: input.ownerId, orgId: ctx.orgId } }))) throw invalid("Responsable inválido.");
  await db.problemTask.create({ data: { problemId, ...input } });
  await log(db, ctx.orgId, "problem", problemId, ctx.user.id, "task_added", input.title);
  if (input.ownerId && input.ownerId !== ctx.user.id) await notify(ctx.orgId, [input.ownerId], { title: `Nueva acción en PRB-${p.number}`, body: input.title, link: `/problems/${problemId}` });
}

export async function toggleTask(ctx: Ctx, taskId: string) {
  assertCan(ctx, "problems:manage");
  const t = await db.problemTask.findFirst({ where: { id: taskId, problem: { orgId: ctx.orgId } } });
  if (!t) throw notFound();
  await db.problemTask.update({ where: { id: taskId }, data: { doneAt: t.doneAt ? null : new Date() } });
  await log(db, ctx.orgId, "problem", t.problemId, ctx.user.id, t.doneAt ? "task_reopened" : "task_done", t.title);
}

export async function deleteTask(ctx: Ctx, taskId: string) {
  assertCan(ctx, "problems:manage");
  const t = await db.problemTask.findFirst({ where: { id: taskId, problem: { orgId: ctx.orgId } } });
  if (!t) throw notFound();
  await db.problemTask.delete({ where: { id: taskId } });
}

export async function addNote(ctx: Ctx, entityType: "problem" | "change", entityId: string, note: string) {
  const n = z.string().trim().min(1, "Escribe una nota.").max(5000).parse(note);
  const exists = entityType === "problem"
    ? await db.problem.findFirst({ where: { id: entityId, orgId: ctx.orgId } })
    : await db.change.findFirst({ where: { id: entityId, orgId: ctx.orgId } });
  if (!exists) throw notFound();
  assertCan(ctx, entityType === "problem" ? "problems:manage" : "changes:create");
  await log(db, ctx.orgId, entityType, entityId, ctx.user.id, "note", n);
}

// ---------------------------------------------------- Conocimiento
/** Publica la solución temporal del error conocido como artículo de la base de conocimientos. */
export async function publishWorkaround(ctx: Ctx, id: string) {
  assertCan(ctx, "problems:manage");
  assertCan(ctx, "kb:manage");
  const p = await db.problem.findFirst({ where: { id, orgId: ctx.orgId }, include: { articles: true } });
  if (!p) throw notFound();
  if (!p.workaround?.trim()) throw invalid("Primero documenta la solución temporal.");
  const body = `Estamos trabajando en una solución definitiva. Mientras tanto, sigue estos pasos:\n\n${p.workaround}\n\nSi esto no te funciona, crea una solicitud y menciona el código PRB-${p.number}.`;
  const existing = p.articles[0];
  if (existing) {
    await db.kbArticle.update({ where: { id: existing.id }, data: { body, status: "PUBLISHED" } });
    await log(db, ctx.orgId, "problem", id, ctx.user.id, "kb_updated", existing.title);
    return existing.slug;
  }
  let slug = slugify(`error conocido ${p.title}`);
  if (await db.kbArticle.findUnique({ where: { orgId_slug: { orgId: ctx.orgId, slug } } })) slug = `${slug}-${p.number}`;
  const a = await db.kbArticle.create({
    data: {
      orgId: ctx.orgId, slug, title: `Solución temporal: ${p.title}`, summary: "Error conocido con solución temporal mientras se aplica la definitiva.",
      body, categoryId: p.categoryId, tags: ["error conocido", `prb-${p.number}`], authorId: ctx.user.id, problems: { connect: { id } },
    },
  });
  await log(db, ctx.orgId, "problem", id, ctx.user.id, "kb_published", a.title);
  return a.slug;
}

/** Resuelve en bloque los incidentes abiertos vinculados, comunicando la solución a cada solicitante. */
export async function resolveLinkedIncidents(ctx: Ctx, id: string) {
  assertCan(ctx, "problems:manage");
  assertCan(ctx, "tickets:work");
  const p = await db.problem.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!p) throw notFound();
  const text = p.permanentFix || p.workaround;
  if (!text) throw invalid("Documenta la solución temporal o definitiva antes de resolver los incidentes.");
  const open = await db.ticket.findMany({ where: { orgId: ctx.orgId, problemId: id, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] } } });
  if (!open.length) throw invalid("No hay incidentes abiertos vinculados.");
  const now = new Date();
  await db.$transaction(async (tx) => {
    for (const t of open) {
      await tx.ticket.update({ where: { id: t.id }, data: { status: "RESOLVED", resolvedAt: now, resolution: `${p.permanentFix ? "Solución definitiva" : "Solución temporal"} (PRB-${p.number}): ${text}`.slice(0, 5000), slaPausedAt: null, firstResponseAt: t.firstResponseAt ?? now } });
      await tx.ticketActivity.create({ data: { ticketId: t.id, actorId: ctx.user.id, action: "status", fromValue: t.status, toValue: "RESOLVED", note: `Resuelto en bloque desde el problema PRB-${p.number}` } });
    }
    await log(tx, ctx.orgId, "problem", id, ctx.user.id, "incidents_resolved", `${open.length} incidente(s)`);
  });
  for (const t of open) {
    await notify(ctx.orgId, [t.requesterId], { kind: "success", title: `${ticketRef(t.type, t.number)} fue solucionado`, body: "Confírmanos si quedó resuelto.", link: `/tickets/${t.id}` });
  }
  return open.length;
}

/** Errores conocidos relevantes para un incidente (misma categoría o mismo CI). */
export async function knownErrorsFor(ctx: Ctx, t: { categoryId: string | null; configItemId: string | null }) {
  if (!t.categoryId && !t.configItemId) return [];
  return db.problem.findMany({
    where: {
      orgId: ctx.orgId, status: { in: ["KNOWN_ERROR", "INVESTIGATING"] }, workaround: { not: null },
      OR: [...(t.categoryId ? [{ categoryId: t.categoryId }] : []), ...(t.configItemId ? [{ configItems: { some: { id: t.configItemId } } }] : [])],
    },
    select: { id: true, number: true, title: true, workaround: true, status: true },
    take: 3,
  });
}
