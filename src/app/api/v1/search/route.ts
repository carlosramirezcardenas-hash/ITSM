import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { getCtx } from "@/server/auth";
import { api } from "@/server/api";
import { ticketRef } from "@/lib/utils";
import { STATUS_LABEL, STATUS_USER_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export const GET = api(async (req: Request) => {
  const ctx = await getCtx();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const staff = can(ctx.user.role, "tickets:work");
  const pages = [
    { title: "Crear una solicitud", href: "/new", k: "nueva crear solicitud problema ayuda" },
    { title: "Mis solicitudes", href: "/my-requests", k: "mis solicitudes estado seguimiento" },
    { title: "Catálogo de servicios", href: "/catalog", k: "catalogo servicios pedir" },
    { title: "Centro de ayuda", href: "/help", k: "ayuda preguntas frecuentes faq articulos" },
    ...(staff ? [{ title: "Bandeja de trabajo", href: "/queue", k: "bandeja cola tickets incidentes" }] : []),
    ...(can(ctx.user.role, "reports:view") ? [{ title: "Dashboard y reportes", href: "/reports", k: "reportes dashboard indicadores sla" }] : []),
    ...(can(ctx.user.role, "approvals:decide") ? [{ title: "Aprobaciones", href: "/approvals", k: "aprobar aprobaciones" }] : []),
    ...(can(ctx.user.role, "problems:manage") ? [{ title: "Problemas", href: "/problems", k: "problemas causa raiz error conocido" }] : []),
    ...(can(ctx.user.role, "changes:create") ? [{ title: "Cambios", href: "/changes", k: "cambios cab calendario" }, { title: "Calendario de cambios", href: "/changes/calendar", k: "calendario ventanas" }] : []),
    ...(can(ctx.user.role, "cmdb:view") ? [{ title: "CMDB", href: "/cmdb", k: "cmdb activos inventario servidores" }] : []),
  ];
  const ql = q.toLowerCase();
  const results: { kind: string; title: string; subtitle?: string; href: string }[] = [];
  if (!q) {
    return { results: pages.map((p) => ({ kind: "page", title: p.title, href: p.href })) };
  }
  const num = Number(q.replace(/^(inc|req)-?/i, ""));
  const tickets = await db.ticket.findMany({
    where: {
      orgId: ctx.orgId,
      ...(staff ? {} : { requesterId: ctx.user.id }),
      OR: [{ title: { contains: q, mode: "insensitive" } }, ...(Number.isInteger(num) && num > 0 ? [{ number: num }] : [])],
    },
    select: { id: true, number: true, type: true, title: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  for (const t of tickets) results.push({ kind: "ticket", title: `${ticketRef(t.type, t.number)} · ${t.title}`, subtitle: (staff ? STATUS_LABEL : STATUS_USER_LABEL)[t.status], href: `/tickets/${t.id}` });
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  const articles = await db.kbArticle.findMany({
    where: { orgId: ctx.orgId, status: "PUBLISHED", OR: [{ title: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }, { tags: { hasSome: words.map((w) => w.toLowerCase()) } }] },
    select: { slug: true, title: true, summary: true }, take: 5,
  });
  for (const a of articles) results.push({ kind: "article", title: a.title, subtitle: a.summary, href: `/help/${a.slug}` });
  const services = await db.serviceItem.findMany({
    where: { orgId: ctx.orgId, isActive: true, OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
    select: { id: true, name: true, description: true }, take: 5,
  });
  for (const s of services) results.push({ kind: "service", title: s.name, subtitle: s.description, href: `/catalog/${s.id}` });
  if (can(ctx.user.role, "problems:manage")) {
    const pn = Number(q.replace(/^prb-?/i, ""));
    const probs = await db.problem.findMany({ where: { orgId: ctx.orgId, OR: [{ title: { contains: q, mode: "insensitive" } }, ...(Number.isInteger(pn) && pn > 0 ? [{ number: pn }] : [])] }, select: { id: true, number: true, title: true }, take: 4 });
    for (const p of probs) results.push({ kind: "ticket", title: `PRB-${p.number} · ${p.title}`, subtitle: "Problema", href: `/problems/${p.id}` });
  }
  if (can(ctx.user.role, "changes:create")) {
    const cn = Number(q.replace(/^chg-?/i, ""));
    const chs = await db.change.findMany({ where: { orgId: ctx.orgId, OR: [{ title: { contains: q, mode: "insensitive" } }, ...(Number.isInteger(cn) && cn > 0 ? [{ number: cn }] : [])] }, select: { id: true, number: true, title: true }, take: 4 });
    for (const c of chs) results.push({ kind: "ticket", title: `CHG-${c.number} · ${c.title}`, subtitle: "Cambio", href: `/changes/${c.id}` });
  }
  if (can(ctx.user.role, "cmdb:view")) {
    const cis = await db.configItem.findMany({ where: { orgId: ctx.orgId, OR: [{ name: { contains: q, mode: "insensitive" } }, { ipAddress: { contains: q } }, { serial: { contains: q, mode: "insensitive" } }] }, select: { id: true, name: true, type: true }, take: 4 });
    for (const c of cis) results.push({ kind: "service", title: c.name, subtitle: "Elemento de la CMDB", href: `/cmdb/${c.id}` });
  }
  for (const p of pages) if (p.title.toLowerCase().includes(ql) || p.k.includes(ql)) results.push({ kind: "page", title: p.title, href: p.href });
  return { results };
});
