import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { type Ctx, assertCan, hashPassword, validatePasswordStrength, type SessionUser } from "./auth";
import { AppError, forbidden, invalid, notFound } from "./errors";
import { audit } from "./audit";
import type { Role } from "@prisma/client";

const id = z.string().min(1);
const optId = z.string().optional().nullable().transform((v) => v || null);

// =============================== USUARIOS ===============================
const ORG_ROLES = ["ORG_ADMIN", "SERVICE_MANAGER", "AGENT", "APPROVER", "END_USER"] as const;

export const userInput = z.object({
  name: z.string().trim().min(2, "Nombre requerido.").max(100),
  email: z.string().trim().toLowerCase().email("Correo inválido."),
  role: z.enum(ORG_ROLES),
  title: z.string().trim().max(100).optional().nullable(),
  departmentId: optId,
  managerId: optId,
  password: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  teamIds: z.array(z.string()).default([]),
});

export async function saveUser(ctx: Ctx, userId: string | null, raw: unknown) {
  assertCan(ctx, "users:manage");
  const input = userInput.parse(raw);
  if (input.departmentId && !(await db.department.findFirst({ where: { id: input.departmentId, orgId: ctx.orgId } }))) throw invalid("Departamento inválido.");
  if (input.managerId) {
    if (input.managerId === userId) throw invalid("Una persona no puede ser su propio jefe.", { managerId: "Selecciona otra persona." });
    if (!(await db.user.findFirst({ where: { id: input.managerId, orgId: ctx.orgId } }))) throw invalid("Jefe directo inválido.");
  }
  const teams = await db.team.findMany({ where: { id: { in: input.teamIds }, orgId: ctx.orgId }, select: { id: true } });
  const dup = await db.user.findUnique({ where: { email: input.email } });
  if (dup && dup.id !== userId) throw invalid("Ya existe un usuario con ese correo.", { email: "Correo en uso." });

  const base = {
    name: input.name, email: input.email, role: input.role as Role, title: input.title || null,
    departmentId: input.departmentId, managerId: input.managerId, isActive: input.isActive,
  };
  let saved;
  if (userId) {
    const existing = await db.user.findFirst({ where: { id: userId, orgId: ctx.orgId } });
    if (!existing) throw notFound();
    if (existing.id === ctx.user.id && (input.role !== existing.role || !input.isActive)) {
      throw invalid("No puedes cambiar tu propio rol ni desactivarte.");
    }
    const pw = input.password ? await checkedHash(input.password) : undefined;
    saved = await db.user.update({ where: { id: userId }, data: { ...base, ...(pw ? { passwordHash: pw } : {}) } });
    if (!input.isActive || pw) await db.session.deleteMany({ where: { userId } });
  } else {
    if (!input.password) throw invalid("Define una contraseña inicial.", { password: "Requerida." });
    saved = await db.user.create({ data: { ...base, orgId: ctx.orgId, passwordHash: await checkedHash(input.password) } });
  }
  await db.teamMember.deleteMany({ where: { userId: saved.id, teamId: { notIn: teams.map((t) => t.id) } } });
  for (const t of teams) {
    await db.teamMember.upsert({ where: { teamId_userId: { teamId: t.id, userId: saved.id } }, create: { teamId: t.id, userId: saved.id }, update: {} });
  }
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: userId ? "user.updated" : "user.created", entity: "user", entityId: saved.id, meta: { role: saved.role, active: saved.isActive } });
  return saved;
}

async function checkedHash(pw: string) {
  const weak = validatePasswordStrength(pw);
  if (weak) throw invalid(weak, { password: weak });
  return hashPassword(pw);
}

export async function listUsers(ctx: Ctx, q?: string) {
  assertCan(ctx, "users:manage");
  return db.user.findMany({
    where: { orgId: ctx.orgId, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}) },
    include: { department: true, manager: { select: { id: true, name: true } }, memberships: { include: { team: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function saveDepartment(ctx: Ctx, name: string) {
  assertCan(ctx, "users:manage");
  const n = z.string().trim().min(2, "Nombre requerido.").max(80).parse(name);
  const d = await db.department.upsert({ where: { orgId_name: { orgId: ctx.orgId, name: n } }, create: { orgId: ctx.orgId, name: n }, update: {} });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "department.saved", entity: "department", entityId: d.id });
  return d;
}

// =============================== EQUIPOS ===============================
export const teamInput = z.object({
  name: z.string().trim().min(2, "Nombre requerido.").max(80),
  description: z.string().trim().max(300).optional().nullable(),
  autoAssign: z.boolean().default(true),
  members: z.array(z.object({ userId: id, isLead: z.boolean().default(false) })).default([]),
});

export async function saveTeam(ctx: Ctx, teamId: string | null, raw: unknown) {
  assertCan(ctx, "teams:manage");
  const input = teamInput.parse(raw);
  const valid = await db.user.findMany({ where: { orgId: ctx.orgId, id: { in: input.members.map((m) => m.userId) }, role: { in: ["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"] } }, select: { id: true } });
  const validIds = new Set(valid.map((v) => v.id));
  const dup = await db.team.findFirst({ where: { orgId: ctx.orgId, name: input.name, ...(teamId ? { id: { not: teamId } } : {}) } });
  if (dup) throw invalid("Ya existe un equipo con ese nombre.", { name: "Nombre en uso." });
  const data = { name: input.name, description: input.description || null, autoAssign: input.autoAssign };
  const team = teamId
    ? await (async () => {
        if (!(await db.team.findFirst({ where: { id: teamId, orgId: ctx.orgId } }))) throw notFound();
        return db.team.update({ where: { id: teamId }, data });
      })()
    : await db.team.create({ data: { ...data, orgId: ctx.orgId } });
  await db.$transaction([
    db.teamMember.deleteMany({ where: { teamId: team.id } }),
    db.teamMember.createMany({ data: input.members.filter((m) => validIds.has(m.userId)).map((m) => ({ teamId: team.id, userId: m.userId, isLead: m.isLead })) }),
  ]);
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: teamId ? "team.updated" : "team.created", entity: "team", entityId: team.id });
  return team;
}

export async function deleteTeam(ctx: Ctx, teamId: string) {
  assertCan(ctx, "teams:manage");
  const t = await db.team.findFirst({ where: { id: teamId, orgId: ctx.orgId }, include: { _count: { select: { tickets: { where: { status: { notIn: ["RESOLVED", "CLOSED"] } } } } } } });
  if (!t) throw notFound();
  if (t._count.tickets > 0) throw invalid(`El equipo tiene ${t._count.tickets} ticket(s) abiertos. Reasígnalos antes de eliminarlo.`);
  await db.team.delete({ where: { id: teamId } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "team.deleted", entity: "team", entityId: teamId, meta: { name: t.name } });
}

// =============================== CATEGORÍAS ===============================
export const categoryInput = z.object({
  name: z.string().trim().min(2).max(60),
  icon: z.string().trim().max(40).default("folder"),
  keywords: z.string().default(""),
  teamId: optId,
});

export async function saveCategory(ctx: Ctx, categoryId: string | null, raw: unknown) {
  assertCan(ctx, "catalog:manage");
  const input = categoryInput.parse(raw);
  if (input.teamId && !(await db.team.findFirst({ where: { id: input.teamId, orgId: ctx.orgId } }))) throw invalid("Equipo inválido.");
  const data = { name: input.name, icon: input.icon, teamId: input.teamId, keywords: input.keywords.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 60) };
  const dup = await db.category.findFirst({ where: { orgId: ctx.orgId, name: input.name, ...(categoryId ? { id: { not: categoryId } } : {}) } });
  if (dup) throw invalid("Ya existe esa categoría.", { name: "Nombre en uso." });
  let c;
  if (categoryId) {
    if (!(await db.category.findFirst({ where: { id: categoryId, orgId: ctx.orgId } }))) throw notFound();
    c = await db.category.update({ where: { id: categoryId }, data });
  } else c = await db.category.create({ data: { ...data, orgId: ctx.orgId } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "category.saved", entity: "category", entityId: c.id });
  return c;
}

export async function deleteCategory(ctx: Ctx, categoryId: string) {
  assertCan(ctx, "catalog:manage");
  const c = await db.category.findFirst({ where: { id: categoryId, orgId: ctx.orgId } });
  if (!c) throw notFound();
  await db.category.delete({ where: { id: categoryId } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "category.deleted", entity: "category", entityId: categoryId, meta: { name: c.name } });
}

// =============================== CATÁLOGO ===============================
const fieldSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, "Clave inválida (minúsculas, números y _)."),
  label: z.string().trim().min(1).max(80),
  type: z.enum(["text", "textarea", "select", "date", "number"]),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).optional(),
  sensitive: z.boolean().default(false),
  placeholder: z.string().max(120).optional(),
});

export const serviceInput = z.object({
  name: z.string().trim().min(3, "Nombre requerido.").max(80),
  description: z.string().trim().min(5, "Agrega una descripción breve.").max(500),
  icon: z.string().trim().max(40).default("package"),
  categoryId: optId,
  estimatedHours: z.coerce.number().int().min(1).max(24 * 60),
  requirements: z.string().trim().max(500).optional().nullable(),
  formSchema: z.array(fieldSchema).max(15).default([]),
  requiresApproval: z.boolean().default(false),
  approvalMode: z.enum(["MANAGER", "USER"]).default("MANAGER"),
  approverId: optId,
  secondApproverId: optId,
  ownerTeamId: optId,
  ownerId: optId,
  defaultPriority: z.enum(["P1", "P2", "P3", "P4"]).default("P3"),
  isActive: z.boolean().default(true),
});

export async function saveService(ctx: Ctx, serviceId: string | null, raw: unknown) {
  assertCan(ctx, "catalog:manage");
  const input = serviceInput.parse(raw);
  const keys = input.formSchema.map((f) => f.key);
  if (new Set(keys).size !== keys.length) throw invalid("Hay campos del formulario con la misma clave.");
  for (const f of input.formSchema) if (f.type === "select" && !f.options?.length) throw invalid(`El campo «${f.label}» necesita opciones.`);
  if (input.requiresApproval && input.approvalMode === "USER" && !input.approverId) throw invalid("Elige quién aprueba.", { approverId: "Requerido." });
  const checks: [string | null, () => Promise<unknown>][] = [
    [input.categoryId, () => db.category.findFirst({ where: { id: input.categoryId!, orgId: ctx.orgId } })],
    [input.ownerTeamId, () => db.team.findFirst({ where: { id: input.ownerTeamId!, orgId: ctx.orgId } })],
    [input.ownerId, () => db.user.findFirst({ where: { id: input.ownerId!, orgId: ctx.orgId } })],
    [input.approverId, () => db.user.findFirst({ where: { id: input.approverId!, orgId: ctx.orgId } })],
    [input.secondApproverId, () => db.user.findFirst({ where: { id: input.secondApproverId!, orgId: ctx.orgId } })],
  ];
  for (const [v, check] of checks) if (v && !(await check())) throw invalid("Referencia inválida en el formulario.");
  const data = { ...input, requirements: input.requirements || null, formSchema: input.formSchema, secondApproverId: input.requiresApproval ? input.secondApproverId : null };
  let s;
  if (serviceId) {
    if (!(await db.serviceItem.findFirst({ where: { id: serviceId, orgId: ctx.orgId } }))) throw notFound();
    s = await db.serviceItem.update({ where: { id: serviceId }, data });
  } else s = await db.serviceItem.create({ data: { ...data, orgId: ctx.orgId } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: serviceId ? "service.updated" : "service.created", entity: "service", entityId: s.id });
  return s;
}

// =============================== SLA ===============================
export const policyInput = z.object({
  name: z.string().trim().min(2).max(80),
  responseMinutes: z.coerce.number().int().min(1).max(60 * 24 * 30),
  resolutionMinutes: z.coerce.number().int().min(1).max(60 * 24 * 90),
  calendarId: optId,
  warnPercent: z.coerce.number().int().min(10).max(95).default(75),
  isActive: z.boolean().default(true),
});

export async function savePolicy(ctx: Ctx, policyId: string, raw: unknown) {
  assertCan(ctx, "sla:manage");
  const input = policyInput.parse(raw);
  if (input.resolutionMinutes < input.responseMinutes) throw invalid("La resolución no puede ser menor que la respuesta.", { resolutionMinutes: "Debe ser ≥ respuesta." });
  if (input.calendarId && !(await db.businessCalendar.findFirst({ where: { id: input.calendarId, orgId: ctx.orgId } }))) throw invalid("Calendario inválido.");
  const p = await db.slaPolicy.findFirst({ where: { id: policyId, orgId: ctx.orgId } });
  if (!p) throw notFound();
  await db.slaPolicy.update({ where: { id: policyId }, data: input });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "sla.policy_updated", entity: "sla_policy", entityId: policyId, meta: input });
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM");
export const calendarInput = z.object({
  name: z.string().trim().min(2).max(80),
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Zona horaria inválida."),
  workDays: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Elige al menos un día."),
  startTime: hhmm,
  endTime: hhmm,
  is24x7: z.boolean().default(false),
});

export async function saveCalendar(ctx: Ctx, calendarId: string | null, raw: unknown) {
  assertCan(ctx, "sla:manage");
  const input = calendarInput.parse(raw);
  if (!input.is24x7 && input.endTime <= input.startTime) throw invalid("La hora de término debe ser posterior a la de inicio.", { endTime: "Revisa el horario." });
  let c;
  if (calendarId) {
    if (!(await db.businessCalendar.findFirst({ where: { id: calendarId, orgId: ctx.orgId } }))) throw notFound();
    c = await db.businessCalendar.update({ where: { id: calendarId }, data: input });
  } else c = await db.businessCalendar.create({ data: { ...input, orgId: ctx.orgId } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "sla.calendar_saved", entity: "calendar", entityId: c.id });
  return c;
}

export async function addHoliday(ctx: Ctx, calendarId: string, raw: unknown) {
  assertCan(ctx, "sla:manage");
  const input = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."), name: z.string().trim().min(2, "Nombre requerido.").max(80) }).parse(raw);
  if (!(await db.businessCalendar.findFirst({ where: { id: calendarId, orgId: ctx.orgId } }))) throw notFound();
  const exists = await db.holiday.findUnique({ where: { calendarId_date: { calendarId, date: input.date } } });
  if (exists) throw invalid("Ya existe un feriado en esa fecha.");
  await db.holiday.create({ data: { calendarId, ...input } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "sla.holiday_added", entity: "calendar", entityId: calendarId, meta: input });
}

export async function removeHoliday(ctx: Ctx, holidayId: string) {
  assertCan(ctx, "sla:manage");
  const h = await db.holiday.findFirst({ where: { id: holidayId, calendar: { orgId: ctx.orgId } } });
  if (!h) throw notFound();
  await db.holiday.delete({ where: { id: holidayId } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "sla.holiday_removed", entity: "calendar", entityId: h.calendarId, meta: { date: h.date } });
}

// =============================== BASE DE CONOCIMIENTOS ===============================
export const articleInput = z.object({
  title: z.string().trim().min(5, "Título demasiado corto.").max(140),
  summary: z.string().trim().min(10, "Agrega un resumen.").max(300),
  body: z.string().trim().min(20, "El contenido es muy corto.").max(20000),
  categoryId: optId,
  tags: z.string().default(""),
  isFaq: z.boolean().default(false),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("PUBLISHED"),
});

export async function saveArticle(ctx: Ctx, articleId: string | null, raw: unknown) {
  assertCan(ctx, "kb:manage");
  const input = articleInput.parse(raw);
  if (input.categoryId && !(await db.category.findFirst({ where: { id: input.categoryId, orgId: ctx.orgId } }))) throw invalid("Categoría inválida.");
  const data = { ...input, tags: input.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 15) };
  let a;
  if (articleId) {
    if (!(await db.kbArticle.findFirst({ where: { id: articleId, orgId: ctx.orgId } }))) throw notFound();
    a = await db.kbArticle.update({ where: { id: articleId }, data });
  } else {
    let slug = slugify(input.title) || "articulo";
    if (await db.kbArticle.findUnique({ where: { orgId_slug: { orgId: ctx.orgId, slug } } })) slug = `${slug}-${Date.now().toString(36)}`;
    a = await db.kbArticle.create({ data: { ...data, slug, orgId: ctx.orgId, authorId: ctx.user.id } });
  }
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: articleId ? "kb.updated" : "kb.created", entity: "article", entityId: a.id });
  return a;
}

export async function deleteArticle(ctx: Ctx, articleId: string) {
  assertCan(ctx, "kb:manage");
  const a = await db.kbArticle.findFirst({ where: { id: articleId, orgId: ctx.orgId } });
  if (!a) throw notFound();
  await db.kbArticle.delete({ where: { id: articleId } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "kb.deleted", entity: "article", entityId: articleId, meta: { title: a.title } });
}

export async function rateArticle(ctx: Ctx, articleId: string, helpful: boolean) {
  const a = await db.kbArticle.findFirst({ where: { id: articleId, orgId: ctx.orgId, status: "PUBLISHED" } });
  if (!a) throw notFound();
  const prev = await db.kbFeedback.findUnique({ where: { articleId_userId: { articleId, userId: ctx.user.id } } });
  if (prev?.helpful === helpful) return;
  await db.$transaction([
    db.kbFeedback.upsert({ where: { articleId_userId: { articleId, userId: ctx.user.id } }, create: { articleId, userId: ctx.user.id, helpful }, update: { helpful } }),
    db.kbArticle.update({
      where: { id: articleId },
      data: {
        helpfulYes: { increment: (helpful ? 1 : 0) - (prev?.helpful === true ? 1 : 0) },
        helpfulNo: { increment: (!helpful ? 1 : 0) - (prev?.helpful === false ? 1 : 0) },
      },
    }),
  ]);
}

// =============================== ORGANIZACIÓN ===============================
export async function saveOrgSettings(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "org:manage");
  const input = z.object({
    name: z.string().trim().min(2).max(100),
    timezone: calendarInput.shape.timezone,
  }).parse(raw);
  await db.organization.update({ where: { id: ctx.orgId }, data: input });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "org.updated", entity: "organization", entityId: ctx.orgId, meta: input });
}

// =============================== PLATAFORMA (SaaS) ===============================
export const orgCreateInput = z.object({
  name: z.string().trim().min(2, "Nombre requerido.").max(100),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/, "Solo minúsculas, números y guiones (3-40)."),
  plan: z.enum(["starter", "business", "enterprise"]).default("starter"),
  adminName: z.string().trim().min(2, "Nombre requerido.").max(100),
  adminEmail: z.string().trim().toLowerCase().email("Correo inválido."),
  adminPassword: z.string(),
});

export async function createOrganization(actor: SessionUser, raw: unknown) {
  if (actor.role !== "SUPER_ADMIN") throw forbidden();
  const input = orgCreateInput.parse(raw);
  if (await db.organization.findUnique({ where: { slug: input.slug } })) throw invalid("Ese identificador ya está en uso.", { slug: "En uso." });
  if (await db.user.findUnique({ where: { email: input.adminEmail } })) throw invalid("Ese correo ya está registrado.", { adminEmail: "En uso." });
  const passwordHash = await checkedHash(input.adminPassword);
  const org = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: input.name, slug: input.slug, plan: input.plan } });
    await tx.user.create({ data: { orgId: org.id, name: input.adminName, email: input.adminEmail, passwordHash, role: "ORG_ADMIN" } });
    // Plantilla inicial: calendario, políticas SLA y un equipo, para que funcione desde el primer minuto.
    const cal = await tx.businessCalendar.create({ data: { orgId: org.id, name: "Horario de oficina", workDays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "18:00", timezone: org.timezone } });
    const defaults = [
      { priority: "P1", name: "Crítica", responseMinutes: 15, resolutionMinutes: 240, calendarId: null },
      { priority: "P2", name: "Alta", responseMinutes: 60, resolutionMinutes: 480, calendarId: cal.id },
      { priority: "P3", name: "Media", responseMinutes: 240, resolutionMinutes: 1440, calendarId: cal.id },
      { priority: "P4", name: "Baja", responseMinutes: 480, resolutionMinutes: 2880, calendarId: cal.id },
    ] as const;
    for (const d of defaults) await tx.slaPolicy.create({ data: { ...d, orgId: org.id } });
    await tx.team.create({ data: { orgId: org.id, name: "Mesa de ayuda", description: "Primer nivel de soporte" } });
    return org;
  });
  await audit({ orgId: null, actor, action: "platform.org_created", entity: "organization", entityId: org.id, meta: { name: org.name, plan: org.plan } });
  return org;
}

export async function setOrganizationActive(actor: SessionUser, orgId: string, active: boolean) {
  if (actor.role !== "SUPER_ADMIN") throw forbidden();
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) throw notFound();
  await db.organization.update({ where: { id: orgId }, data: { isActive: active } });
  if (!active) await db.session.deleteMany({ where: { user: { orgId } } });
  await audit({ orgId: null, actor, action: active ? "platform.org_activated" : "platform.org_suspended", entity: "organization", entityId: orgId });
}

export { AppError };
