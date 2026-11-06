import "server-only";
import { z } from "zod";
import type { Prisma, Priority } from "@prisma/client";
import { db } from "@/lib/db";
import { ACTIONS, ruleMatches, TRIGGERS, validateRule, type Action, type Condition, type Trigger } from "@/lib/automation";
import { ticketRef } from "@/lib/utils";
import { type Ctx, assertCan } from "./auth";
import { invalid, notFound } from "./errors";
import { computeSla } from "./sla";
import { managerIds, notify, teamMemberIds } from "./notify";
import { pickAssignee } from "./tickets";
import { audit } from "./audit";

/**
 * Ejecuta las reglas activas de un disparador sobre un ticket. Los cambios hechos por una
 * automatización no vuelven a disparar reglas (evita bucles).
 */
export async function runAutomations(orgId: string, trigger: Trigger, ticketId: string) {
  const rules = await db.automationRule.findMany({ where: { orgId, trigger, isActive: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  if (!rules.length) return 0;
  let ran = 0;
  for (const rule of rules) {
    const t = await db.ticket.findFirst({ where: { id: ticketId, orgId }, include: { requester: { select: { department: { select: { name: true } } } } } });
    if (!t) return ran;
    const facts = {
      type: t.type, priority: t.priority, impact: t.impact, urgency: t.urgency, categoryId: t.categoryId, teamId: t.teamId,
      channel: t.channel, title: t.title, description: t.description, requesterDepartment: t.requester.department?.name ?? null,
    };
    if (!ruleMatches(rule.conditions as unknown as Condition[], facts)) continue;
    try {
      await applyActions(orgId, rule.name, t, rule.actions as unknown as Action[]);
      await db.automationRule.update({ where: { id: rule.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } });
      ran++;
    } catch (e) {
      console.error("[automation]", rule.id, e);
    }
  }
  return ran;
}

async function applyActions(orgId: string, ruleName: string, t: { id: string; number: number; type: string; title: string; teamId: string | null; assigneeId: string | null; status: string; priority: Priority; createdAt: Date; slaPausedMinutes: number; firstResponseAt: Date | null; escalationLevel: number }, actions: Action[]) {
  const data: Prisma.TicketUncheckedUpdateInput = {};
  const notes: string[] = [];
  const toNotify: { ids: string[]; title: string }[] = [];
  const ref = ticketRef(t.type, t.number);
  let teamId = t.teamId;
  for (const a of actions) {
    switch (a.type) {
      case "assign_team": {
        const team = await db.team.findFirst({ where: { id: String(a.value), orgId } });
        if (!team) break;
        data.teamId = team.id; teamId = team.id;
        const auto = await pickAssignee(orgId, team.id);
        data.assigneeId = auto;
        if (["NEW", "ASSIGNED"].includes(t.status)) data.status = auto ? "ASSIGNED" : "NEW";
        notes.push(`derivado a ${team.name}`);
        if (auto) toNotify.push({ ids: [auto], title: `Te asignaron ${ref} (automatización)` });
        break;
      }
      case "assign_user": {
        const u = await db.user.findFirst({ where: { id: String(a.value), orgId, isActive: true, role: { in: ["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"] } } });
        if (!u) break;
        data.assigneeId = u.id;
        if (t.status === "NEW") data.status = "ASSIGNED";
        notes.push(`asignado a ${u.name}`);
        toNotify.push({ ids: [u.id], title: `Te asignaron ${ref} (automatización)` });
        break;
      }
      case "set_priority": {
        const p = String(a.value) as Priority;
        if (p === t.priority) break;
        Object.assign(data, await computeSla(orgId, p, t.createdAt, t.slaPausedMinutes), { priority: p, slaWarned: false });
        if (t.firstResponseAt) delete (data as Record<string, unknown>).responseDueAt;
        notes.push(`prioridad ${t.priority} → ${p}`);
        break;
      }
      case "notify_users": {
        const ids = (Array.isArray(a.value) ? a.value : [String(a.value)]);
        const valid = await db.user.findMany({ where: { orgId, id: { in: ids }, isActive: true }, select: { id: true } });
        toNotify.push({ ids: valid.map((v) => v.id), title: `Automatización «${ruleName}»: ${ref}` });
        break;
      }
      case "notify_managers":
        toNotify.push({ ids: [...(await managerIds(orgId)), ...(await teamMemberIds(teamId, true))], title: `Automatización «${ruleName}»: ${ref}` });
        break;
      case "add_note":
        await db.ticketComment.create({ data: { ticketId: t.id, authorId: await systemAuthor(orgId), body: String(a.value).slice(0, 2000), isInternal: true } });
        notes.push("nota interna agregada");
        break;
      case "escalate":
        data.escalationLevel = { increment: 1 };
        notes.push(`escalado a nivel ${t.escalationLevel + 1}`);
        toNotify.push({ ids: [...(await managerIds(orgId)), ...(await teamMemberIds(teamId, true))], title: `${ref} escalado por automatización` });
        break;
    }
  }
  await db.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.ticket.update({ where: { id: t.id }, data });
    await tx.ticketActivity.create({ data: { ticketId: t.id, action: "automation", toValue: ruleName, note: notes.join(", ") || "notificación enviada" } });
  });
  for (const n of toNotify) await notify(orgId, n.ids, { kind: "info", title: n.title, body: t.title, link: `/tickets/${t.id}` });
}

/** Las notas automáticas se firman con el primer administrador de la organización (autor requerido por el modelo). */
async function systemAuthor(orgId: string) {
  const u = await db.user.findFirst({ where: { orgId, role: "ORG_ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!u) throw new Error("Organización sin administrador");
  return u.id;
}

// ------------------------------------------------------------------ CRUD
export const ruleInput = z.object({
  name: z.string().trim().min(3, "Ponle un nombre a la regla.").max(100),
  description: z.string().trim().max(300).optional().nullable(),
  trigger: z.enum(Object.keys(TRIGGERS) as [Trigger, ...Trigger[]]),
  conditions: z.array(z.object({ field: z.string(), op: z.string(), value: z.union([z.string(), z.array(z.string())]) })).max(10),
  actions: z.array(z.object({ type: z.string(), value: z.union([z.string(), z.array(z.string())]).optional() })).max(10),
  isActive: z.boolean().default(true),
});

export async function saveRule(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "catalog:manage");
  const input = ruleInput.parse(raw);
  const err = validateRule(input.conditions, input.actions);
  if (err) throw invalid(err);
  // Las referencias deben pertenecer a la organización
  for (const a of input.actions as Action[]) {
    const vals = Array.isArray(a.value) ? a.value : a.value ? [a.value] : [];
    if (a.type === "assign_team" && !(await db.team.findFirst({ where: { id: vals[0], orgId: ctx.orgId } }))) throw invalid("Equipo inválido en la acción.");
    if ((a.type === "assign_user" || a.type === "notify_users") && (await db.user.count({ where: { id: { in: vals }, orgId: ctx.orgId } })) !== vals.length) throw invalid("Usuario inválido en la acción.");
  }
  const data = { name: input.name, description: input.description || null, trigger: input.trigger, conditions: input.conditions, actions: input.actions, isActive: input.isActive };
  let r;
  if (id) {
    if (!(await db.automationRule.findFirst({ where: { id, orgId: ctx.orgId } }))) throw notFound();
    r = await db.automationRule.update({ where: { id }, data });
  } else {
    const position = await db.automationRule.count({ where: { orgId: ctx.orgId } });
    r = await db.automationRule.create({ data: { ...data, orgId: ctx.orgId, position } });
  }
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: id ? "automation.updated" : "automation.created", entity: "automation", entityId: r.id, meta: { name: r.name } });
  return r;
}

export async function deleteRule(ctx: Ctx, id: string) {
  assertCan(ctx, "catalog:manage");
  const r = await db.automationRule.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!r) throw notFound();
  await db.automationRule.delete({ where: { id } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "automation.deleted", entity: "automation", entityId: id, meta: { name: r.name } });
}

export async function toggleRule(ctx: Ctx, id: string, isActive: boolean) {
  assertCan(ctx, "catalog:manage");
  const r = await db.automationRule.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!r) throw notFound();
  await db.automationRule.update({ where: { id }, data: { isActive } });
}

export { ACTIONS, TRIGGERS };
