import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dependenciesOf, impactedBy, impactFromServices } from "@/lib/itsm";
import { type Ctx, assertCan } from "./auth";
import { invalid, notFound } from "./errors";
import { audit } from "./audit";

export const CI_TYPES = ["HARDWARE", "SERVER", "APPLICATION", "DATABASE", "NETWORK", "LICENSE", "SERVICE", "VENDOR"] as const;
export const REL_TYPES = ["DEPENDS_ON", "RUNS_ON", "USES", "SUPPLIED_BY", "CONNECTS_TO"] as const;

const optStr = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

export const ciInput = z.object({
  name: z.string().trim().min(2, "Nombre requerido.").max(120),
  type: z.enum(CI_TYPES),
  status: z.enum(["ACTIVE", "MAINTENANCE", "RETIRED"]).default("ACTIVE"),
  criticality: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  description: optStr(1000),
  ownerId: optStr(),
  teamId: optStr(),
  serial: optStr(),
  location: optStr(),
  ipAddress: optStr(60),
  version: optStr(60),
  seats: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  seatsUsed: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.").optional().nullable().or(z.literal("")).transform((v) => v || null),
  contact: optStr(300),
});

export async function listCIs(ctx: Ctx, f: { type?: string; q?: string; status?: string }) {
  assertCan(ctx, "cmdb:view");
  const where: Prisma.ConfigItemWhereInput = { orgId: ctx.orgId };
  if (f.type && (CI_TYPES as readonly string[]).includes(f.type)) where.type = f.type as (typeof CI_TYPES)[number];
  if (f.status && ["ACTIVE", "MAINTENANCE", "RETIRED"].includes(f.status)) where.status = f.status as "ACTIVE";
  if (f.q) where.OR = [{ name: { contains: f.q, mode: "insensitive" } }, { serial: { contains: f.q, mode: "insensitive" } }, { ipAddress: { contains: f.q } }, { location: { contains: f.q, mode: "insensitive" } }];
  return db.configItem.findMany({
    where,
    include: { owner: { select: { name: true } }, team: { select: { name: true } }, _count: { select: { incoming: true, outgoing: true, tickets: { where: { status: { notIn: ["RESOLVED", "CLOSED"] } } } } } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
}

async function validateRefs(ctx: Ctx, input: z.infer<typeof ciInput>) {
  if (input.ownerId && !(await db.user.findFirst({ where: { id: input.ownerId, orgId: ctx.orgId } }))) throw invalid("Responsable inválido.");
  if (input.teamId && !(await db.team.findFirst({ where: { id: input.teamId, orgId: ctx.orgId } }))) throw invalid("Equipo inválido.");
  if (input.seats != null && input.seatsUsed != null && input.seatsUsed > input.seats) throw invalid("Las licencias usadas superan las disponibles.", { seatsUsed: "Revisa la cantidad." });
}

export async function saveCI(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "cmdb:manage");
  const input = ciInput.parse(raw);
  await validateRefs(ctx, input);
  const dup = await db.configItem.findFirst({ where: { orgId: ctx.orgId, name: input.name, ...(id ? { id: { not: id } } : {}) } });
  if (dup) throw invalid("Ya existe un elemento con ese nombre.", { name: "Nombre en uso." });
  let ci;
  if (id) {
    if (!(await db.configItem.findFirst({ where: { id, orgId: ctx.orgId } }))) throw notFound();
    ci = await db.configItem.update({ where: { id }, data: input });
  } else ci = await db.configItem.create({ data: { ...input, orgId: ctx.orgId } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: id ? "cmdb.updated" : "cmdb.created", entity: "ci", entityId: ci.id, meta: { name: ci.name, type: ci.type } });
  return ci;
}

export async function deleteCI(ctx: Ctx, id: string) {
  assertCan(ctx, "cmdb:manage");
  const ci = await db.configItem.findFirst({ where: { id, orgId: ctx.orgId }, include: { _count: { select: { tickets: { where: { status: { notIn: ["RESOLVED", "CLOSED"] } } }, changes: { where: { status: { in: ["SCHEDULED", "IN_PROGRESS", "PENDING_APPROVAL"] } } } } } } });
  if (!ci) throw notFound();
  if (ci._count.tickets || ci._count.changes) throw invalid("Tiene tickets abiertos o cambios en curso. Márcalo como «Retirado» en lugar de eliminarlo.");
  await db.configItem.delete({ where: { id } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "cmdb.deleted", entity: "ci", entityId: id, meta: { name: ci.name } });
}

export async function addRelation(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "cmdb:manage");
  const r = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1), type: z.enum(REL_TYPES).default("DEPENDS_ON") }).parse(raw);
  if (r.sourceId === r.targetId) throw invalid("Un elemento no puede depender de sí mismo.");
  const n = await db.configItem.count({ where: { orgId: ctx.orgId, id: { in: [r.sourceId, r.targetId] } } });
  if (n !== 2) throw invalid("Elementos inválidos.");
  const exists = await db.ciRelation.findFirst({ where: { sourceId: r.sourceId, targetId: r.targetId } });
  if (exists) throw invalid("Esa relación ya existe.");
  await db.ciRelation.create({ data: r });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "cmdb.relation_added", entity: "ci", entityId: r.sourceId, meta: r });
}

export async function removeRelation(ctx: Ctx, relationId: string) {
  assertCan(ctx, "cmdb:manage");
  const rel = await db.ciRelation.findFirst({ where: { id: relationId, source: { orgId: ctx.orgId } } });
  if (!rel) throw notFound();
  await db.ciRelation.delete({ where: { id: relationId } });
  await audit({ orgId: ctx.orgId, actor: ctx.user, action: "cmdb.relation_removed", entity: "ci", entityId: rel.sourceId });
}

async function orgGraph(orgId: string) {
  const [items, edges] = await Promise.all([
    db.configItem.findMany({ where: { orgId }, select: { id: true, name: true, type: true, criticality: true, status: true } }),
    db.ciRelation.findMany({ where: { source: { orgId } }, select: { sourceId: true, targetId: true, type: true } }),
  ]);
  return { byId: new Map(items.map((i) => [i.id, i])), edges };
}

/** Análisis de impacto: qué se ve afectado si fallan los elementos indicados. */
export async function impactAnalysis(ctx: Ctx, ciIds: string[]) {
  const { byId, edges } = await orgGraph(ctx.orgId);
  const affected = new Map<string, { id: string; name: string; type: string; criticality: "LOW" | "MEDIUM" | "HIGH"; depth: number }>();
  for (const root of ciIds.filter((id) => byId.has(id))) {
    for (const hit of impactedBy(root, edges)) {
      const ci = byId.get(hit.id)!;
      const prev = affected.get(hit.id);
      if (!prev || prev.depth > hit.depth) affected.set(hit.id, { ...ci, depth: hit.depth });
    }
  }
  const list = [...affected.values()].sort((a, b) => a.depth - b.depth);
  // Los propios elementos tipo servicio también cuentan como servicios afectados
  const services = [...list.filter((x) => x.type === "SERVICE"), ...ciIds.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x && x.type === "SERVICE").map((x) => ({ ...x, depth: 0 }))];
  return { affected: list, services, impact: services.length ? impactFromServices(services) : list.length ? "LOW" as const : "LOW" as const, criticalServices: services.filter((s) => s.criticality === "HIGH").length };
}

export async function getCI(ctx: Ctx, id: string) {
  assertCan(ctx, "cmdb:view");
  const ci = await db.configItem.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      owner: { select: { id: true, name: true } }, team: { select: { id: true, name: true } },
      outgoing: { include: { target: { select: { id: true, name: true, type: true, status: true } } } },
      incoming: { include: { source: { select: { id: true, name: true, type: true, status: true } } } },
      tickets: { where: { status: { notIn: ["CLOSED"] } }, select: { id: true, number: true, type: true, title: true, status: true, priority: true }, orderBy: { createdAt: "desc" }, take: 10 },
      problems: { select: { id: true, number: true, title: true, status: true }, take: 10 },
      changes: { select: { id: true, number: true, title: true, status: true, plannedStart: true }, orderBy: { plannedStart: "desc" }, take: 10 },
    },
  });
  if (!ci) throw notFound();
  const { byId, edges } = await orgGraph(ctx.orgId);
  const impacted = impactedBy(id, edges).map((h) => ({ ...byId.get(h.id)!, depth: h.depth, via: byId.get(h.via)?.name ?? "" }));
  const dependencies = dependenciesOf(id, edges).map((h) => ({ ...byId.get(h.id)!, depth: h.depth }));
  const incidents90 = await db.ticket.count({ where: { orgId: ctx.orgId, configItemId: id, type: "INCIDENT", createdAt: { gt: new Date(Date.now() - 90 * 86400_000) } } });
  return { ...ci, impacted, dependencies, incidents90 };
}
