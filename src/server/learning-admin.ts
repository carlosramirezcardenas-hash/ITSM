import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { type Ctx, assertCan } from "./auth";
import { audit } from "./audit";
import { notFound } from "./errors";
import { syncLearning } from "./learning";

/** Administración de lo que aprendió el asistente: todo se puede revisar, corregir, ocultar o borrar. */

const actor = (ctx: Ctx) => ({ id: ctx.user.id, name: ctx.user.name });

export async function learningOverview(ctx: Ctx) {
  assertCan(ctx, "catalog:manage");
  const since = new Date(Date.now() - 30 * 86400_000);
  const where = { orgId: ctx.orgId, createdAt: { gte: since } };
  const [total, selfResolved, toTicket, toService, up, down, solutions, terms, recentBad] = await Promise.all([
    db.assistantInteraction.count({ where }),
    db.assistantInteraction.count({ where: { ...where, outcome: "self_resolved" } }),
    db.assistantInteraction.count({ where: { ...where, outcome: "ticket" } }),
    db.assistantInteraction.count({ where: { ...where, outcome: "service" } }),
    db.assistantInteraction.count({ where: { ...where, feedback: 1 } }),
    db.assistantInteraction.count({ where: { ...where, feedback: -1 } }),
    db.learnedSolution.findMany({
      where: { orgId: ctx.orgId }, orderBy: [{ status: "asc" }, { helpful: "desc" }, { updatedAt: "desc" }], take: 200,
      select: { id: true, ticketIds: true, title: true, resolution: true, status: true, hiddenReason: true, manual: true, shown: true, helpful: true, notHelpful: true, updatedAt: true, category: { select: { name: true } } },
    }),
    db.assistantTerm.findMany({ where: { orgId: ctx.orgId, positive: { gt: 0 } }, orderBy: [{ positive: "desc" }, { updatedAt: "desc" }], take: 200 }),
    db.assistantInteraction.findMany({
      where: { ...where, OR: [{ feedback: -1 }, { AND: [{ articleIds: { isEmpty: true } }, { solutionIds: { isEmpty: true } }, { serviceId: null }, { intent: { in: ["problem", "question", "other"] } }] }] },
      orderBy: { createdAt: "desc" }, take: 15, select: { id: true, query: true, feedback: true, createdAt: true },
    }),
  ]);
  // Nombres de los destinos del vocabulario
  const ids = (t: string) => terms.filter((x) => x.targetType === t).map((x) => x.targetId);
  const [svc, art, sol] = await Promise.all([
    db.serviceItem.findMany({ where: { orgId: ctx.orgId, id: { in: ids("SERVICE") } }, select: { id: true, name: true } }),
    db.kbArticle.findMany({ where: { orgId: ctx.orgId, id: { in: ids("ARTICLE") } }, select: { id: true, title: true } }),
    db.learnedSolution.findMany({ where: { orgId: ctx.orgId, id: { in: ids("SOLUTION") } }, select: { id: true, title: true } }),
  ]);
  const names = new Map<string, string>([
    ...svc.map((x) => [`SERVICE:${x.id}`, x.name] as [string, string]),
    ...art.map((x) => [`ARTICLE:${x.id}`, x.title] as [string, string]),
    ...sol.map((x) => [`SOLUTION:${x.id}`, x.title] as [string, string]),
  ]);
  return {
    stats: { total, selfResolved, toTicket, toService, up, down },
    solutions,
    terms: terms.map((t) => ({ ...t, targetName: names.get(`${t.targetType}:${t.targetId}`) ?? null })).filter((t) => t.targetName),
    recentBad,
  };
}

export async function runLearningSync(ctx: Ctx) {
  assertCan(ctx, "catalog:manage");
  const r = await syncLearning(ctx.orgId);
  await audit({ orgId: ctx.orgId, actor: actor(ctx), action: "assistant.sync", entity: "LearnedSolution", meta: r });
  return r;
}

export async function setSolutionStatus(ctx: Ctx, id: string, status: "ACTIVE" | "HIDDEN") {
  assertCan(ctx, "catalog:manage");
  const s = await db.learnedSolution.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!s) throw notFound();
  await db.learnedSolution.update({ where: { id }, data: { status, manual: true, hiddenReason: status === "HIDDEN" ? `Ocultada por ${ctx.user.name}` : null } });
  await audit({ orgId: ctx.orgId, actor: actor(ctx), action: status === "HIDDEN" ? "assistant.solution.hide" : "assistant.solution.show", entity: "LearnedSolution", entityId: id });
}

const solutionEdit = z.object({
  title: z.string().trim().min(5, "Mínimo 5 caracteres.").max(200),
  resolution: z.string().trim().min(20, "Describe la solución en al menos 20 caracteres.").max(2000),
});
export async function editSolution(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "catalog:manage");
  const input = solutionEdit.parse(raw);
  const s = await db.learnedSolution.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!s) throw notFound();
  await db.learnedSolution.update({ where: { id }, data: { ...input, manual: true } });
  await audit({ orgId: ctx.orgId, actor: actor(ctx), action: "assistant.solution.edit", entity: "LearnedSolution", entityId: id });
}

export async function setTermDisabled(ctx: Ctx, id: string, disabled: boolean) {
  assertCan(ctx, "catalog:manage");
  const t = await db.assistantTerm.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!t) throw notFound();
  await db.assistantTerm.update({ where: { id }, data: { disabled } });
  await audit({ orgId: ctx.orgId, actor: actor(ctx), action: disabled ? "assistant.term.disable" : "assistant.term.enable", entity: "AssistantTerm", entityId: id, meta: { term: t.term } });
}

export async function deleteTerm(ctx: Ctx, id: string) {
  assertCan(ctx, "catalog:manage");
  const t = await db.assistantTerm.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!t) throw notFound();
  await db.assistantTerm.delete({ where: { id } });
  await audit({ orgId: ctx.orgId, actor: actor(ctx), action: "assistant.term.delete", entity: "AssistantTerm", entityId: id, meta: { term: t.term } });
}
