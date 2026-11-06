import "server-only";
import { z } from "zod";
import type { Level, Prisma, TicketStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { classifyCategory, priorityMatrix, similarity, suggestLevels } from "@/lib/classify";
import { decrypt, encrypt, isEncrypted } from "@/lib/crypto";
import { STATUS_LABEL, PRIORITY_LABEL } from "@/lib/labels";
import { ticketRef } from "@/lib/utils";
import type { Ctx } from "./auth";
import { forbidden, invalid, notFound } from "./errors";
import { computeSla, resumeSlaData } from "./sla";
import { managerIds, notify, teamMemberIds } from "./notify";
import { audit } from "./audit";
import { after } from "next/server";

/** Trabajo posterior a la respuesta: automatizaciones, IA e integraciones (no demora al usuario). */
function afterCreate(ctx: Ctx, ticket: { id: string; type: string; number: number; title: string; priority: string }) {
  after(async () => {
    const { runAutomations } = await import("./automation");
    const { dispatch } = await import("./integrations");
    const { aiAvailable } = await import("./ai");
    try { await runAutomations(ctx.orgId, "ticket.created", ticket.id); } catch (e) { console.error("[automation]", e); }
    const t = await db.ticket.findUnique({ where: { id: ticket.id }, select: { priority: true, title: true, category: { select: { name: true } } } });
    const ref = ticketRef(ticket.type, ticket.number);
    const payload = { title: `${ref} · ${ticket.title}`, text: `Prioridad ${t?.priority ?? ticket.priority}${t?.category ? ` · ${t.category.name}` : ""}`, link: `/tickets/${ticket.id}`, fields: { Prioridad: t?.priority ?? ticket.priority, Solicitante: ctx.user.name } };
    await dispatch(ctx.orgId, "ticket.created", payload).catch(() => {});
    if ((t?.priority ?? ticket.priority) === "P1") await dispatch(ctx.orgId, "ticket.critical", payload).catch(() => {});
    if (ticket.type === "INCIDENT" && (await aiAvailable(ctx.orgId))) {
      const { triageTicket } = await import("./ai-features");
      await triageTicket(ctx, ticket.id).catch((e) => console.error("[ai-triage]", e?.message));
    }
  });
}

// ------------------------------------------------------------------
// Validación
// ------------------------------------------------------------------
const level = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const incidentInput = z.object({
  title: z.string().trim().min(5, "Describe el problema en al menos 5 caracteres.").max(160, "Máximo 160 caracteres."),
  description: z.string().trim().max(5000).optional().default(""),
  impact: level.default("LOW"),
  urgency: level.default("MEDIUM"),
  categoryId: z.string().optional().nullable(),
  requesterId: z.string().optional().nullable(), // agente registra en nombre de alguien
  channel: z.enum(["portal", "phone", "email", "chat", "walk-in", "api"]).default("portal"),
});

export type FormField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "date" | "number";
  required?: boolean;
  options?: string[];
  sensitive?: boolean;
  placeholder?: string;
};

export const requestInput = z.object({
  serviceItemId: z.string().min(1),
  answers: z.record(z.string(), z.string()).default({}),
  note: z.string().trim().max(3000).optional().default(""),
  requesterId: z.string().optional().nullable(),
});

export const updateInput = z.object({
  status: z.enum(["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  pendingReason: z.string().trim().max(200).optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  impact: level.optional(),
  urgency: level.optional(),
  categoryId: z.string().optional().nullable(),
  configItemId: z.string().optional().nullable(),
  problemId: z.string().optional().nullable(),
  resolution: z.string().trim().max(5000).optional().nullable(),
});

// Máquina de estados (ITIL 4 — gestión de incidentes / solicitudes)
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["ASSIGNED", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"],
  ASSIGNED: ["NEW", "IN_PROGRESS", "PENDING", "RESOLVED"],
  IN_PROGRESS: ["ASSIGNED", "PENDING", "RESOLVED"],
  PENDING: ["ASSIGNED", "IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};
export function canTransition(from: TicketStatus, to: TicketStatus) {
  return from === to || TRANSITIONS[from].includes(to);
}
export function allowedNext(from: TicketStatus) {
  return TRANSITIONS[from];
}

// ------------------------------------------------------------------
// Utilidades internas
// ------------------------------------------------------------------
async function nextNumber(tx: Prisma.TransactionClient, orgId: string) {
  const org = await tx.organization.update({ where: { id: orgId }, data: { ticketSeq: { increment: 1 } }, select: { ticketSeq: true } });
  return org.ticketSeq;
}

/** Asignación automática: el agente del equipo con menos tickets abiertos. */
export async function pickAssignee(orgId: string, teamId: string | null | undefined): Promise<string | null> {
  if (!teamId) return null;
  const team = await db.team.findFirst({ where: { id: teamId, orgId }, select: { autoAssign: true } });
  if (!team?.autoAssign) return null;
  const members = await db.teamMember.findMany({
    where: { teamId, user: { isActive: true, role: { in: ["AGENT", "SERVICE_MANAGER"] } } },
    select: { userId: true, user: { select: { role: true } } },
  });
  if (!members.length) return null;
  const agents = members.filter((m) => m.user.role === "AGENT");
  const pool = (agents.length ? agents : members).map((m) => m.userId);
  const loads = await db.ticket.groupBy({
    by: ["assigneeId"],
    where: { orgId, assigneeId: { in: pool }, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] } },
    _count: { _all: true },
  });
  const load = new Map(loads.map((l) => [l.assigneeId, l._count._all]));
  return pool.sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0] ?? null;
}

async function nameOf(userId: string | null) {
  if (!userId) return null;
  return (await db.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? null;
}

async function resolveRequester(ctx: Ctx, requesterId?: string | null) {
  if (!requesterId || requesterId === ctx.user.id) return ctx.user.id;
  if (!can(ctx.user.role, "tickets:work")) throw forbidden("Solo el equipo de soporte puede registrar solicitudes en nombre de otra persona.");
  const u = await db.user.findFirst({ where: { id: requesterId, orgId: ctx.orgId, isActive: true } });
  if (!u) throw invalid("El solicitante no existe en tu organización.", { requesterId: "Selecciona un usuario válido." });
  return u.id;
}

async function activity(tx: Prisma.TransactionClient, ticketId: string, actorId: string | null, action: string, fromValue?: string | null, toValue?: string | null, note?: string) {
  await tx.ticketActivity.create({ data: { ticketId, actorId, action, fromValue: fromValue ?? null, toValue: toValue ?? null, note } });
}

function isStaff(ctx: Ctx) {
  return can(ctx.user.role, "tickets:work");
}

/** Reglas de visibilidad: staff ve la organización; el resto, sus propios tickets o los que debe aprobar. */
async function loadVisibleTicket(ctx: Ctx, id: string) {
  const t = await db.ticket.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!t) throw notFound("Este ticket no existe o no pertenece a tu organización.");
  if (isStaff(ctx) || t.requesterId === ctx.user.id) return t;
  const approval = await db.approval.findFirst({ where: { ticketId: id, approverId: ctx.user.id } });
  if (approval) return t;
  throw notFound("Este ticket no existe o no pertenece a tu organización.");
}

// ------------------------------------------------------------------
// Sugerencias (clasificación, artículos, duplicados)
// ------------------------------------------------------------------
export async function suggestForText(ctx: Ctx, text: string) {
  const categories = await db.category.findMany({ where: { orgId: ctx.orgId } });
  const match = classifyCategory(text, categories);
  const levels = suggestLevels(text);
  const articles = text.trim().length < 4 ? [] : await db.kbArticle.findMany({
    where: { orgId: ctx.orgId, status: "PUBLISHED" },
    select: { id: true, title: true, slug: true, summary: true, tags: true },
  });
  const scored = articles
    .map((a) => ({ ...a, score: similarity(text, `${a.title} ${a.summary} ${a.tags.join(" ")}`) }))
    .filter((a) => a.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return {
    category: match ? { id: match.category.id, name: match.category.name, matched: match.matched } : null,
    impact: levels.impact,
    urgency: levels.urgency,
    articles: scored.map(({ id, title, slug, summary }) => ({ id, title, slug, summary })),
  };
}

export async function similarTickets(ctx: Ctx, ticketId: string) {
  const t = await loadVisibleTicket(ctx, ticketId);
  if (!isStaff(ctx)) return [];
  const recent = await db.ticket.findMany({
    where: { orgId: ctx.orgId, id: { not: t.id }, createdAt: { gt: new Date(Date.now() - 90 * 86400_000) } },
    select: { id: true, number: true, type: true, title: true, status: true, description: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const base = `${t.title} ${t.description}`;
  return recent
    .map((r) => ({ ...r, score: similarity(base, `${r.title} ${r.description}`) }))
    .filter((r) => r.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ description: _d, ...r }) => r);
}

// ------------------------------------------------------------------
// Creación
// ------------------------------------------------------------------
export async function createIncident(ctx: Ctx, raw: unknown) {
  const input = incidentInput.parse(raw);
  const requesterId = await resolveRequester(ctx, input.requesterId);
  const text = `${input.title} ${input.description}`;

  let categoryId = input.categoryId || null;
  let autoClassified = false;
  if (categoryId) {
    const exists = await db.category.findFirst({ where: { id: categoryId, orgId: ctx.orgId } });
    if (!exists) throw invalid("Categoría inválida.");
  } else {
    const categories = await db.category.findMany({ where: { orgId: ctx.orgId } });
    const m = classifyCategory(text, categories);
    if (m) { categoryId = m.category.id; autoClassified = true; }
  }
  const hints = suggestLevels(text);
  // El usuario decide; las pistas del texto solo pueden subir el nivel, nunca bajarlo.
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  const impact: Level = hints.impact && rank[hints.impact] > rank[input.impact] ? hints.impact : input.impact;
  const urgency: Level = hints.urgency && rank[hints.urgency] > rank[input.urgency] ? hints.urgency : input.urgency;
  const priority = priorityMatrix(impact, urgency);

  const category = categoryId ? await db.category.findUnique({ where: { id: categoryId } }) : null;
  const teamId = category?.teamId ?? null;
  const assigneeId = await pickAssignee(ctx.orgId, teamId);
  const now = new Date();
  const sla = await computeSla(ctx.orgId, priority, now);
  const assigneeName = await nameOf(assigneeId);

  const ticket = await db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId);
    const t = await tx.ticket.create({
      data: {
        orgId: ctx.orgId, number, type: "INCIDENT", title: input.title, description: input.description,
        impact, urgency, priority, categoryId, teamId, assigneeId, requesterId, channel: input.channel,
        status: assigneeId ? "ASSIGNED" : "NEW", ...sla,
      },
    });
    await activity(tx, t.id, ctx.user.id, "created", null, null, requesterId !== ctx.user.id ? "Registrado por el equipo de soporte" : undefined);
    if (autoClassified && category) await activity(tx, t.id, null, "classified", null, category.name, "Clasificación automática por palabras clave");
    if (assigneeId) await activity(tx, t.id, null, "assigned", null, assigneeName, "Asignación automática por carga de trabajo");
    return t;
  });

  const ref = ticketRef("INCIDENT", ticket.number);
  await notify(ctx.orgId, assigneeId ? [assigneeId] : await teamMemberIds(teamId), {
    kind: priority === "P1" ? "danger" : "info",
    title: `${assigneeId ? "Te asignaron" : "Nuevo incidente en tu equipo"}: ${ref}`,
    body: `${PRIORITY_LABEL[priority]} · ${ticket.title}`,
    link: `/tickets/${ticket.id}`,
  }, ctx.user.id);
  if (priority === "P1") {
    await notify(ctx.orgId, await managerIds(ctx.orgId), { kind: "danger", title: `Incidente crítico ${ref}`, body: ticket.title, link: `/tickets/${ticket.id}` }, ctx.user.id);
  }
  if (requesterId !== ctx.user.id) {
    await notify(ctx.orgId, [requesterId], { title: `Registramos tu problema ${ref}`, body: ticket.title, link: `/tickets/${ticket.id}` });
  }
  afterCreate(ctx, ticket);
  return ticket;
}

export async function createRequest(ctx: Ctx, raw: unknown) {
  const input = requestInput.parse(raw);
  const requesterId = await resolveRequester(ctx, input.requesterId);
  const service = await db.serviceItem.findFirst({ where: { id: input.serviceItemId, orgId: ctx.orgId, isActive: true } });
  if (!service) throw notFound("Este servicio ya no está disponible.");

  // Validación del formulario configurable
  const schema = (service.formSchema as unknown as FormField[]) ?? [];
  const fields: Record<string, string> = {};
  const formData: Record<string, string> = {};
  for (const f of schema) {
    const v = (input.answers[f.key] ?? "").trim();
    if (f.required && !v) fields[`answers.${f.key}`] = "Este campo es obligatorio.";
    if (v && f.type === "select" && f.options && !f.options.includes(v)) fields[`answers.${f.key}`] = "Selecciona una opción válida.";
    if (v && f.type === "number" && Number.isNaN(Number(v))) fields[`answers.${f.key}`] = "Debe ser un número.";
    if (v.length > 2000) fields[`answers.${f.key}`] = "Texto demasiado largo.";
    if (v) formData[f.key] = f.sensitive ? encrypt(v) : v;
  }
  if (Object.keys(fields).length) throw invalid("Revisa los campos marcados.", fields);

  const requester = await db.user.findUnique({ where: { id: requesterId }, select: { managerId: true, name: true } });
  let approverId: string | null = null;
  if (service.requiresApproval) {
    approverId = service.approvalMode === "USER" ? service.approverId : requester?.managerId ?? service.approverId;
    if (!approverId) {
      const fallback = await db.user.findFirst({ where: { orgId: ctx.orgId, role: { in: ["APPROVER", "ORG_ADMIN"] }, isActive: true, id: { not: requesterId } } });
      approverId = fallback?.id ?? null;
    }
    if (approverId === requesterId) approverId = service.approverId && service.approverId !== requesterId ? service.approverId : null;
  }
  const needsApproval = !!approverId;
  const priority = service.defaultPriority;
  const teamId = service.ownerTeamId;
  const assigneeId = needsApproval ? null : await pickAssignee(ctx.orgId, teamId);
  const now = new Date();
  const sla = await computeSla(ctx.orgId, priority, now);
  const urgency: Level = priority === "P1" || priority === "P2" ? "HIGH" : priority === "P3" ? "MEDIUM" : "LOW";

  const description = input.note || service.description;
  const assigneeName = await nameOf(assigneeId);
  const ticket = await db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId);
    const t = await tx.ticket.create({
      data: {
        orgId: ctx.orgId, number, type: "REQUEST", title: service.name, description,
        priority, impact: "LOW", urgency, categoryId: service.categoryId, serviceItemId: service.id, formData,
        requesterId, teamId, assigneeId,
        status: needsApproval ? "PENDING" : assigneeId ? "ASSIGNED" : "NEW",
        pendingReason: needsApproval ? "Esperando aprobación" : null,
        approvalStatus: needsApproval ? "PENDING" : "NOT_REQUIRED",
        slaPausedAt: needsApproval ? now : null,
        ...sla,
      },
    });
    await activity(tx, t.id, ctx.user.id, "created");
    if (needsApproval) {
      await tx.approval.create({ data: { ticketId: t.id, approverId: approverId! } });
      await activity(tx, t.id, null, "approval", null, "PENDING", "Se solicitó aprobación");
    } else if (assigneeId) {
      await activity(tx, t.id, null, "assigned", null, assigneeName, "Asignación automática por carga de trabajo");
    }
    await tx.serviceItem.update({ where: { id: service.id }, data: { popularity: { increment: 1 } } });
    return t;
  });

  const ref = ticketRef("REQUEST", ticket.number);
  if (needsApproval) {
    await notify(ctx.orgId, [approverId], {
      kind: "warning", title: `Aprobación pendiente: ${ref}`, body: `${requester?.name} solicita «${service.name}»`, link: `/approvals`, email: true,
    });
  } else {
    await notify(ctx.orgId, assigneeId ? [assigneeId] : await teamMemberIds(teamId), {
      title: `${assigneeId ? "Te asignaron" : "Nueva solicitud"}: ${ref}`, body: service.name, link: `/tickets/${ticket.id}`,
    }, ctx.user.id);
  }
  afterCreate(ctx, ticket);
  return ticket;
}

// ------------------------------------------------------------------
// Consulta
// ------------------------------------------------------------------
export const listFilters = z.object({
  view: z.enum(["mine", "team", "unassigned", "breaching", "all", "requested"]).default("all"),
  type: z.enum(["INCIDENT", "REQUEST"]).optional(),
  status: z.enum(["open", "NEW", "ASSIGNED", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED", "any"]).default("open"),
  priority: z.enum(["P1", "P2", "P3", "P4"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export async function listTickets(ctx: Ctx, raw: unknown) {
  const f = listFilters.parse(raw);
  const where: Prisma.TicketWhereInput = { orgId: ctx.orgId };
  const staff = isStaff(ctx);
  if (!staff || f.view === "requested") where.requesterId = ctx.user.id;
  else if (f.view === "mine") where.assigneeId = ctx.user.id;
  else if (f.view === "team") {
    const teams = await db.teamMember.findMany({ where: { userId: ctx.user.id }, select: { teamId: true } });
    where.teamId = { in: teams.map((t) => t.teamId) };
  } else if (f.view === "unassigned") where.assigneeId = null;
  else if (f.view === "breaching") {
    where.OR = [{ resolutionBreached: true }, { slaWarned: true }, { responseBreached: true }];
  }
  if (f.type) where.type = f.type;
  if (f.status === "open") where.status = { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] };
  else if (f.status !== "any") where.status = f.status;
  if (f.priority) where.priority = f.priority;
  if (f.q) {
    const n = Number(f.q.replace(/^(inc|req)-/i, ""));
    where.AND = [{ OR: [{ title: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }, ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : [])] }];
  }
  const pageSize = 25;
  const [items, total] = await Promise.all([
    db.ticket.findMany({
      where,
      include: {
        requester: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
      orderBy: staff && f.view !== "requested" ? [{ priority: "asc" }, { createdAt: "desc" }] : [{ updatedAt: "desc" }],
      skip: (f.page - 1) * pageSize,
      take: pageSize,
    }),
    db.ticket.count({ where }),
  ]);
  return { items, total, page: f.page, pageSize, filters: f };
}

export async function getTicket(ctx: Ctx, id: string) {
  await loadVisibleTicket(ctx, id);
  const staff = isStaff(ctx);
  const t = await db.ticket.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      requester: { select: { id: true, name: true, email: true, title: true, department: { select: { name: true } } } },
      assignee: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      serviceItem: { select: { id: true, name: true, formSchema: true, estimatedHours: true } },
      slaPolicy: { select: { name: true, warnPercent: true } },
      comments: {
        where: staff ? {} : { isInternal: false },
        include: { author: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
      activities: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      approvals: { include: { approver: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      problem: { select: { id: true, number: true, title: true, status: true, workaround: true } },
      configItem: { select: { id: true, name: true, type: true } },
      linkedArticles: { select: { id: true, slug: true, title: true } },
    },
  });
  if (!t) throw notFound();
  // Descifrado de campos sensibles: solo staff, el solicitante y aprobadores.
  const schema = (t.serviceItem?.formSchema as unknown as FormField[]) ?? [];
  const answers = Object.entries((t.formData as Record<string, string>) ?? {}).map(([key, value]) => {
    const field = schema.find((f) => f.key === key);
    return { key, label: field?.label ?? key, value: isEncrypted(value) ? decrypt(value) : value, sensitive: !!field?.sensitive };
  });
  return { ...t, answers, activities: staff ? t.activities : t.activities.filter((a) => ["created", "status", "approval", "reopened"].includes(a.action)) };
}

// ------------------------------------------------------------------
// Actualización / flujo de trabajo
// ------------------------------------------------------------------
export async function updateTicket(ctx: Ctx, id: string, raw: unknown) {
  if (!isStaff(ctx)) throw forbidden();
  const input = updateInput.parse(raw);
  const t = await loadVisibleTicket(ctx, id);
  if (t.status === "CLOSED") throw invalid("El ticket está cerrado. Para retomarlo, debe reabrirse.");
  if (t.approvalStatus === "PENDING" && input.status && input.status !== t.status) {
    throw invalid("Esta solicitud está esperando aprobación. No puede avanzar hasta que se apruebe.");
  }

  const data: Prisma.TicketUncheckedUpdateInput = {};
  const acts: { action: string; from?: string | null; to?: string | null; note?: string }[] = [];
  const notifications: { to: (string | null)[]; title: string; body?: string; kind?: "info" | "success" | "warning" | "danger" }[] = [];
  const ref = ticketRef(t.type, t.number);
  const now = new Date();

  // Equipo (escalamiento funcional)
  if (input.teamId !== undefined && input.teamId !== t.teamId) {
    if (input.teamId) {
      const team = await db.team.findFirst({ where: { id: input.teamId, orgId: ctx.orgId } });
      if (!team) throw invalid("Equipo inválido.");
      if (!can(ctx.user.role, "tickets:assignAny") && !(await db.teamMember.findFirst({ where: { userId: ctx.user.id } }))) throw forbidden();
      acts.push({ action: "escalated", from: null, to: team.name, note: "Escalamiento funcional a otro equipo" });
      notifications.push({ to: await teamMemberIds(team.id), title: `${ref} fue derivado a ${team.name}`, body: t.title });
    }
    data.teamId = input.teamId;
    if (input.assigneeId === undefined) {
      // Derivación: se reasigna automáticamente dentro del nuevo equipo
      const auto = await pickAssignee(ctx.orgId, input.teamId);
      data.assigneeId = auto;
      if (["ASSIGNED", "IN_PROGRESS", "NEW"].includes(t.status) && !input.status) data.status = auto ? "ASSIGNED" : "NEW";
      if (auto) {
        acts.push({ action: "assigned", to: await nameOf(auto), note: "Asignación automática por carga de trabajo" });
        notifications.push({ to: [auto], title: `Te asignaron ${ref}`, body: t.title });
      }
    }
  }

  // Asignación
  if (input.assigneeId !== undefined && input.assigneeId !== t.assigneeId) {
    if (input.assigneeId) {
      const a = await db.user.findFirst({ where: { id: input.assigneeId, orgId: ctx.orgId, isActive: true } });
      if (!a || !can(a.role, "tickets:work")) throw invalid("Solo puedes asignar a agentes de soporte activos.");
      if (input.assigneeId !== ctx.user.id && !can(ctx.user.role, "tickets:assignAny")) {
        // Un agente puede reasignar dentro de sus equipos
        const shared = await db.teamMember.findFirst({ where: { userId: input.assigneeId, team: { members: { some: { userId: ctx.user.id } } } } });
        if (!shared) throw forbidden("Solo puedes asignar a miembros de tus equipos.");
      }
      acts.push({ action: "assigned", from: await nameOf(t.assigneeId), to: a.name });
      if (a.id !== ctx.user.id) notifications.push({ to: [a.id], title: `Te asignaron ${ref}`, body: t.title });
      if (t.status === "NEW" && !input.status) data.status = "ASSIGNED";
    } else {
      acts.push({ action: "assigned", from: await nameOf(t.assigneeId), to: null });
    }
    data.assigneeId = input.assigneeId;
  }

  // Impacto / urgencia → prioridad y SLA
  const impact = input.impact ?? t.impact;
  const urgency = input.urgency ?? t.urgency;
  if (impact !== t.impact || urgency !== t.urgency) {
    const priority = priorityMatrix(impact, urgency);
    data.impact = impact;
    data.urgency = urgency;
    if (priority !== t.priority) {
      data.priority = priority;
      const sla = await computeSla(ctx.orgId, priority, t.createdAt, t.slaPausedMinutes);
      Object.assign(data, sla, { slaWarned: false });
      if (t.firstResponseAt) delete (data as Record<string, unknown>).responseDueAt;
      acts.push({ action: "priority", from: t.priority, to: priority });
    }
  }

  if (input.categoryId !== undefined && input.categoryId !== t.categoryId) {
    if (input.categoryId) {
      const c = await db.category.findFirst({ where: { id: input.categoryId, orgId: ctx.orgId } });
      if (!c) throw invalid("Categoría inválida.");
      acts.push({ action: "category", to: c.name });
    }
    data.categoryId = input.categoryId;
  }

  // Elemento de configuración afectado (CMDB) y problema vinculado
  if (input.configItemId !== undefined && input.configItemId !== t.configItemId) {
    if (input.configItemId) {
      const ci = await db.configItem.findFirst({ where: { id: input.configItemId, orgId: ctx.orgId } });
      if (!ci) throw invalid("Elemento de configuración inválido.");
      acts.push({ action: "ci", to: ci.name });
    }
    data.configItemId = input.configItemId;
  }
  if (input.problemId !== undefined && input.problemId !== t.problemId) {
    if (input.problemId) {
      const pr = await db.problem.findFirst({ where: { id: input.problemId, orgId: ctx.orgId } });
      if (!pr) throw invalid("Problema inválido.");
      acts.push({ action: "problem", to: `PRB-${pr.number}` });
    }
    data.problemId = input.problemId;
  }

  // Estado
  const to = input.status;
  if (to && to !== t.status) {
    if (!canTransition(t.status, to)) throw invalid(`No se puede pasar de «${STATUS_LABEL[t.status]}» a «${STATUS_LABEL[to]}».`);
    const effectiveAssignee = data.assigneeId !== undefined ? data.assigneeId : t.assigneeId;
    if ((to === "ASSIGNED" || to === "IN_PROGRESS") && !effectiveAssignee) {
      if (to === "IN_PROGRESS") data.assigneeId = ctx.user.id; // "Tomar" el ticket
      else throw invalid("Para marcarlo como asignado, elige un responsable.");
    }
    if (to === "PENDING") {
      if (!input.pendingReason) throw invalid("Indica qué estás esperando.", { pendingReason: "Selecciona un motivo." });
      data.pendingReason = input.pendingReason;
      data.slaPausedAt = now;
    }
    if (t.status === "PENDING" && to !== "PENDING") {
      Object.assign(data, await resumeSlaData(t));
      data.pendingReason = null;
    }
    if (to === "RESOLVED") {
      const resolution = input.resolution ?? t.resolution;
      if (!resolution || resolution.length < 5) throw invalid("Describe brevemente la solución aplicada.", { resolution: "Requerido para resolver." });
      data.resolution = resolution;
      data.resolvedAt = now;
      notifications.push({ to: [t.requesterId], kind: "success", title: `${ref} fue solucionado`, body: "Confírmanos si quedó resuelto y evalúa la atención." });
    }
    if (to === "CLOSED") data.closedAt = now;
    if (t.status === "RESOLVED" && to === "IN_PROGRESS") {
      data.reopenCount = { increment: 1 };
      data.resolvedAt = null;
      acts.push({ action: "reopened", note: "Reabierto por el equipo de soporte" });
    }
    if (!t.firstResponseAt && ["IN_PROGRESS", "PENDING", "RESOLVED"].includes(to)) data.firstResponseAt = now;
    data.status = to;
    acts.push({ action: "status", from: t.status, to });
    if (to === "PENDING" && input.pendingReason?.includes("usuario")) {
      notifications.push({ to: [t.requesterId], kind: "warning", title: `Necesitamos información sobre ${ref}`, body: "Responde en el ticket para que podamos continuar." });
    }
  } else if (input.resolution !== undefined && input.resolution !== t.resolution) {
    data.resolution = input.resolution;
  }

  if (!Object.keys(data).length) return t;

  const updated = await db.$transaction(async (tx) => {
    const u = await tx.ticket.update({ where: { id: t.id }, data });
    for (const a of acts) await activity(tx, t.id, ctx.user.id, a.action, a.from, a.to, a.note);
    return u;
  });
  for (const n of notifications) await notify(ctx.orgId, n.to, { title: n.title, body: n.body, kind: n.kind, link: `/tickets/${t.id}` }, ctx.user.id);
  if (to === "RESOLVED") {
    after(async () => {
      const { dispatch } = await import("./integrations");
      await dispatch(ctx.orgId, "ticket.resolved", { title: `${ref} · ${t.title}`, text: `Resuelto por ${ctx.user.name}: ${String(data.resolution ?? "").slice(0, 300)}`, link: `/tickets/${t.id}` }).catch(() => {});
    });
  }
  return updated;
}

/** Escalamiento jerárquico manual: notifica a líderes y gestores. */
export async function escalateHierarchical(ctx: Ctx, id: string, reason: string) {
  if (!isStaff(ctx)) throw forbidden();
  const r = z.string().trim().min(5, "Explica brevemente por qué escalas.").max(500).parse(reason);
  const t = await loadVisibleTicket(ctx, id);
  if (["RESOLVED", "CLOSED"].includes(t.status)) throw invalid("No se puede escalar un ticket resuelto o cerrado.");
  await db.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id }, data: { escalationLevel: { increment: 1 } } });
    await activity(tx, id, ctx.user.id, "escalated", String(t.escalationLevel), String(t.escalationLevel + 1), r);
  });
  const to = [...(await teamMemberIds(t.teamId, true)), ...(await managerIds(ctx.orgId))];
  await notify(ctx.orgId, to, { kind: "warning", title: `Escalamiento de ${ticketRef(t.type, t.number)}`, body: r, link: `/tickets/${id}` }, ctx.user.id);
}

export async function addComment(ctx: Ctx, id: string, raw: unknown) {
  const input = z.object({
    body: z.string().trim().min(1, "Escribe un mensaje.").max(5000),
    isInternal: z.boolean().default(false),
  }).parse(raw);
  const t = await loadVisibleTicket(ctx, id);
  const staff = isStaff(ctx);
  if (input.isInternal && !staff) throw forbidden();
  if (!staff && t.requesterId !== ctx.user.id) throw forbidden("Solo el solicitante puede escribir en este ticket.");
  if (t.status === "CLOSED") throw invalid("El ticket está cerrado. Si el problema persiste, crea uno nuevo o reábrelo.");

  const data: Prisma.TicketUncheckedUpdateInput = {};
  const now = new Date();
  if (staff && !input.isInternal && !t.firstResponseAt) data.firstResponseAt = now;
  // Automatización: si esperábamos al usuario y responde, el ticket vuelve a "En progreso".
  let autoResumed = false;
  if (!staff && t.status === "PENDING" && t.approvalStatus !== "PENDING") {
    Object.assign(data, await resumeSlaData(t), { status: "IN_PROGRESS", pendingReason: null });
    autoResumed = true;
  }
  const comment = await db.$transaction(async (tx) => {
    const c = await tx.ticketComment.create({ data: { ticketId: id, authorId: ctx.user.id, body: input.body, isInternal: input.isInternal } });
    if (Object.keys(data).length) await tx.ticket.update({ where: { id }, data });
    else await tx.ticket.update({ where: { id }, data: { updatedAt: now } });
    if (autoResumed) await activity(tx, id, null, "status", "PENDING", "IN_PROGRESS", "Reanudado automáticamente: el usuario respondió");
    return c;
  });
  const ref = ticketRef(t.type, t.number);
  if (staff && !input.isInternal) {
    await notify(ctx.orgId, [t.requesterId], { title: `Nueva respuesta en ${ref}`, body: input.body.slice(0, 140), link: `/tickets/${id}` }, ctx.user.id);
  } else if (!staff) {
    await notify(ctx.orgId, t.assigneeId ? [t.assigneeId] : await teamMemberIds(t.teamId), { title: `${ctx.user.name} respondió en ${ref}`, body: input.body.slice(0, 140), link: `/tickets/${id}` }, ctx.user.id);
  }
  return comment;
}

/** El solicitante confirma la solución (cierra) o indica que sigue el problema (reabre). */
export async function confirmResolution(ctx: Ctx, id: string, raw: unknown) {
  const input = z.object({
    solved: z.boolean(),
    score: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(1000).optional(),
  }).parse(raw);
  const t = await loadVisibleTicket(ctx, id);
  if (t.requesterId !== ctx.user.id) throw forbidden("Solo quien hizo la solicitud puede confirmarla.");
  const now = new Date();
  const ref = ticketRef(t.type, t.number);
  if (input.solved) {
    if (!["RESOLVED", "CLOSED"].includes(t.status)) throw invalid("Este ticket aún no está solucionado.");
    if (t.csatScore && t.status === "CLOSED") throw invalid("Ya evaluaste esta atención. ¡Gracias!");
    await db.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: { status: "CLOSED", closedAt: t.closedAt ?? now, csatScore: input.score ?? null, csatComment: input.comment || null },
      });
      if (t.status !== "CLOSED") await activity(tx, id, ctx.user.id, "status", t.status, "CLOSED", "El usuario confirmó la solución");
      if (input.score) await activity(tx, id, ctx.user.id, "csat", null, String(input.score), input.comment);
    });
    if (input.score && input.score <= 2) {
      await notify(ctx.orgId, [t.assigneeId, ...(await teamMemberIds(t.teamId, true))], { kind: "warning", title: `Evaluación baja (${input.score}/5) en ${ref}`, body: input.comment, link: `/tickets/${id}` });
    }
  } else {
    if (t.status === "CLOSED" && t.closedAt && now.getTime() - t.closedAt.getTime() > 14 * 86400_000) {
      throw invalid("Pasaron más de 14 días desde el cierre. Crea un ticket nuevo y menciona este número.");
    }
    if (!["RESOLVED", "CLOSED"].includes(t.status)) throw invalid("Solo se pueden reabrir tickets solucionados o cerrados.");
    await db.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: { status: t.assigneeId ? "IN_PROGRESS" : "NEW", resolvedAt: null, closedAt: null, reopenCount: { increment: 1 }, csatScore: null, csatComment: null },
      });
      await activity(tx, id, ctx.user.id, "reopened", t.status, t.assigneeId ? "IN_PROGRESS" : "NEW", input.comment || "El usuario indicó que el problema continúa");
      if (input.comment) await tx.ticketComment.create({ data: { ticketId: id, authorId: ctx.user.id, body: input.comment } });
    });
    await notify(ctx.orgId, t.assigneeId ? [t.assigneeId] : await teamMemberIds(t.teamId), { kind: "warning", title: `${ref} fue reabierto`, body: input.comment || t.title, link: `/tickets/${id}` });
    after(async () => { const { runAutomations } = await import("./automation"); await runAutomations(ctx.orgId, "ticket.reopened", id).catch(() => {}); });
  }
}

// ------------------------------------------------------------------
// Aprobaciones
// ------------------------------------------------------------------
export async function listMyApprovals(ctx: Ctx, status: "PENDING" | "DONE" = "PENDING") {
  return db.approval.findMany({
    where: { approverId: ctx.user.id, ticket: { orgId: ctx.orgId }, ...(status === "PENDING" ? { status: "PENDING" } : { status: { in: ["APPROVED", "REJECTED"] } }) },
    include: {
      ticket: {
        include: {
          requester: { select: { name: true, department: { select: { name: true } } } },
          serviceItem: { select: { name: true, icon: true, formSchema: true } },
        },
      },
    },
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 50,
  });
}

export async function decideApproval(ctx: Ctx, approvalId: string, raw: unknown) {
  const input = z.object({ approve: z.boolean(), comment: z.string().trim().max(1000).optional() }).parse(raw);
  const ap = await db.approval.findFirst({ where: { id: approvalId, ticket: { orgId: ctx.orgId } }, include: { ticket: true } });
  if (!ap) throw notFound();
  if (ap.approverId !== ctx.user.id) throw forbidden("Esta aprobación está asignada a otra persona.");
  if (ap.status !== "PENDING") throw invalid("Esta solicitud ya fue decidida.");
  if (!input.approve && !input.comment) throw invalid("Indica el motivo del rechazo para que el solicitante lo entienda.", { comment: "Requerido al rechazar." });
  const t = ap.ticket;
  const now = new Date();
  const ref = ticketRef(t.type, t.number);
  // Aprobación multinivel: si el servicio define un segundo aprobador, el nivel 1 abre el nivel 2
  if (input.approve && ap.level === 1 && t.serviceItemId) {
    const svc = await db.serviceItem.findUnique({ where: { id: t.serviceItemId }, select: { secondApproverId: true, name: true } });
    const second = svc?.secondApproverId;
    if (second && second !== ap.approverId && second !== t.requesterId) {
      await db.$transaction(async (tx) => {
        await tx.approval.update({ where: { id: ap.id }, data: { status: "APPROVED", comment: input.comment, decidedAt: now } });
        await tx.approval.create({ data: { ticketId: t.id, approverId: second, level: 2 } });
        await activity(tx, t.id, ctx.user.id, "approval", "PENDING", "APPROVED", `Nivel 1 aprobado${input.comment ? `: ${input.comment}` : ""}. Pasa a segundo nivel.`);
      });
      await notify(ctx.orgId, [second], { kind: "warning", title: `Aprobación pendiente (nivel 2): ${ref}`, body: svc!.name, link: "/approvals" });
      await notify(ctx.orgId, [t.requesterId], { kind: "info", title: `Tu solicitud ${ref} pasó el primer nivel de aprobación`, body: "Ahora espera la aprobación final.", link: `/tickets/${t.id}` });
      await audit({ orgId: ctx.orgId, actor: ctx.user, action: "approval.approved", entity: "ticket", entityId: t.id, meta: { level: 1 } });
      return;
    }
  }
  if (input.approve) {
    const resume = await resumeSlaData(t);
    const assigneeId = await pickAssignee(ctx.orgId, t.teamId);
    const assigneeName = await nameOf(assigneeId);
    await db.$transaction(async (tx) => {
      await tx.approval.update({ where: { id: ap.id }, data: { status: "APPROVED", comment: input.comment, decidedAt: now } });
      await tx.ticket.update({
        where: { id: t.id },
        data: { ...resume, approvalStatus: "APPROVED", status: assigneeId ? "ASSIGNED" : "NEW", pendingReason: null, assigneeId },
      });
      await activity(tx, t.id, ctx.user.id, "approval", "PENDING", "APPROVED", input.comment);
      if (assigneeId) await activity(tx, t.id, null, "assigned", null, assigneeName, "Asignación automática por carga de trabajo");
    });
    await notify(ctx.orgId, [t.requesterId], { kind: "success", title: `Tu solicitud ${ref} fue aprobada`, body: "El equipo de soporte ya está trabajando en ella.", link: `/tickets/${t.id}` });
    await notify(ctx.orgId, assigneeId ? [assigneeId] : await teamMemberIds(t.teamId), { title: `Solicitud aprobada lista para atender: ${ref}`, body: t.title, link: `/tickets/${t.id}` });
  } else {
    await db.$transaction(async (tx) => {
      await tx.approval.update({ where: { id: ap.id }, data: { status: "REJECTED", comment: input.comment, decidedAt: now } });
      await tx.ticket.update({ where: { id: t.id }, data: { approvalStatus: "REJECTED", status: "CLOSED", closedAt: now, slaPausedAt: null, pendingReason: null, resolution: `Rechazada: ${input.comment}` } });
      await activity(tx, t.id, ctx.user.id, "approval", "PENDING", "REJECTED", input.comment);
    });
    await notify(ctx.orgId, [t.requesterId], { kind: "danger", title: `Tu solicitud ${ref} no fue aprobada`, body: input.comment, link: `/tickets/${t.id}` });
  }
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: input.approve ? "approval.approved" : "approval.rejected", entity: "ticket", entityId: t.id });
}

/** Relación conocimiento ↔ ticket: el agente vincula el artículo que usó (o lo desvincula). */
export async function linkArticle(ctx: Ctx, ticketId: string, articleId: string, link: boolean) {
  if (!isStaff(ctx)) throw forbidden();
  const t = await loadVisibleTicket(ctx, ticketId);
  const a = await db.kbArticle.findFirst({ where: { id: articleId, orgId: ctx.orgId } });
  if (!a) throw notFound("Artículo no encontrado.");
  await db.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: t.id }, data: { linkedArticles: link ? { connect: { id: a.id } } : { disconnect: { id: a.id } } } });
    await activity(tx, t.id, ctx.user.id, "article", null, link ? a.title : null, link ? undefined : `Desvinculado: ${a.title}`);
  });
}
