import Link from "next/link";
import type { Metadata } from "next";
import {
  AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Clock, HelpCircle, KeyRound, LifeBuoy, PackagePlus, ShieldAlert, Sparkles, Star, Ticket, Timer, Wrench,
} from "lucide-react";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requireCtx, type Ctx } from "@/server/auth";
import { agentStats, getMetrics } from "@/server/metrics";
import { riskRanking } from "@/server/predictive";
import { RiskList } from "@/components/risk-list";
import { Badge, Card, CardHeader, EmptyState, Stat, buttonClass } from "@/components/ui";
import { AgentTicketRow, SimpleTicketRow } from "@/components/ticket-list";
import { TrendChart, ComplianceChart } from "@/components/charts";
import { getExperience } from "@/server/experience";
import { Carousel } from "@/components/carousel";
import { ServiceTile } from "@/components/service-tiles";
import { formatMinutes, ticketRef, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Inicio" };
export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const ctx = await requireCtx();
  const { denied } = await searchParams;
  const r = ctx.user.role;
  const banner = denied ? <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">No tienes acceso a esa sección. Te trajimos al inicio.</p> : null;
  if ((await getExperience(r)) === "employee") return <>{banner}<UserHome ctx={ctx} /></>;
  if (r === "ORG_ADMIN" || r === "SERVICE_MANAGER") return <>{banner}<ManagerHome ctx={ctx} /></>;
  if (r === "AGENT") return <>{banner}<AgentHome ctx={ctx} /></>;
  return <>{banner}<UserHome ctx={ctx} /></>;
}

const greeting = () => {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Santiago" }));
  return h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
};

// ============================================================ Usuario final
async function UserHome({ ctx }: { ctx: Ctx }) {
  const [open, recent, articles, approvals, toConfirm, popular, catOrder] = await Promise.all([
    db.ticket.findMany({ where: { orgId: ctx.orgId, requesterId: ctx.user.id, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] } }, orderBy: { updatedAt: "desc" }, take: 6 }),
    db.ticket.findMany({ where: { orgId: ctx.orgId, requesterId: ctx.user.id, status: { in: ["CLOSED"] } }, orderBy: { updatedAt: "desc" }, take: 3 }),
    db.kbArticle.findMany({ where: { orgId: ctx.orgId, status: "PUBLISHED" }, orderBy: { views: "desc" }, take: 4, select: { slug: true, title: true, summary: true } }),
    can(ctx.user.role, "approvals:decide") ? db.approval.count({ where: { approverId: ctx.user.id, status: "PENDING", ticket: { orgId: ctx.orgId } } }) : 0,
    db.ticket.findMany({ where: { orgId: ctx.orgId, requesterId: ctx.user.id, status: "RESOLVED" }, orderBy: { resolvedAt: "desc" }, take: 3 }),
    db.serviceItem.findMany({
      where: { orgId: ctx.orgId, isActive: true }, orderBy: [{ popularity: "desc" }, { name: "asc" }], take: 10,
      select: { id: true, name: true, description: true, icon: true, estimatedHours: true, requiresApproval: true, category: { select: { name: true } } },
    }),
    db.category.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  const order = catOrder.map((c) => c.name);
  const quick = [
    { href: "/new/issue", icon: Wrench, title: "Tengo un problema", desc: "Algo no funciona" },
    { href: "/catalog?c=access", icon: KeyRound, title: "Necesito acceso", desc: "Sistemas, carpetas, VPN" },
    { href: "/catalog", icon: PackagePlus, title: "Quiero solicitar algo", desc: "Equipos, programas, accesorios" },
    { href: "/my-requests", icon: Clock, title: "Ver mis solicitudes", desc: "Estado y seguimiento" },
    { href: "/help", icon: LifeBuoy, title: "Necesito ayuda", desc: "Guías y preguntas frecuentes" },
  ];
  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-border bg-gradient-to-br from-primary-soft via-card to-card px-6 py-10 text-center sm:px-10 sm:py-14">
        <p className="text-sm text-muted">{greeting()}, {ctx.user.name.split(" ")[0]} 👋</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">¿En qué podemos ayudarte?</h1>
        <form action="/assistant" className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-xl border border-border bg-card p-1.5 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
          <Sparkles className="ml-2 h-4 w-4 shrink-0 text-violet-500" />
          <input name="q" required minLength={2} maxLength={1000} placeholder="Ej: no me funciona la VPN, necesito un notebook…" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" aria-label="Pregúntale al asistente" />
          <button className={buttonClass("secondary", "sm")}>Preguntar</button>
        </form>
        <p className="mt-2 text-xs text-muted">El asistente te muestra la solución, el servicio indicado o te deja el reporte listo para enviar.</p>
        <Link href="/new" className={buttonClass("primary", "lg", "mt-5")}>Crear solicitud <ArrowRight className="h-4 w-4" /></Link>
      </section>

      {approvals > 0 && (
        <Link href="/approvals" className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <ShieldAlert className="h-5 w-5" />
          <p className="flex-1 text-sm"><strong>{approvals} solicitud(es)</strong> esperan tu aprobación.</p>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}

      {toConfirm.length > 0 && (
        <Card className="border-emerald-200 dark:border-emerald-900">
          <CardHeader title="¿Quedó solucionado?" description="Confírmanos para cerrar tu solicitud y cuéntanos cómo te atendimos." />
          <div className="divide-y divide-border">
            {toConfirm.map((t) => (
              <Link key={t.id} href={`/tickets/${t.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-subtle">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="flex-1 truncate text-sm">{t.title}</span>
                <span className="text-xs font-medium text-primary">Confirmar y evaluar →</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Accesos rápidos</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {quick.map((q) => (
            <Link key={q.href} href={q.href} className="group rounded-xl border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm">
              <q.icon className="h-5 w-5 text-primary" />
              <p className="mt-3 text-sm font-medium">{q.title}</p>
              <p className="text-xs text-muted">{q.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {popular.length > 0 && (
        <Carousel title="Lo más pedido" subtitle="Elige y listo: sin formularios complicados" seeAll="/catalog">
          {popular.map((s) => <ServiceTile key={s.id} s={s} order={order} />)}
        </Carousel>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Mis solicitudes en curso" action={<Link href="/my-requests" className="text-xs text-primary hover:underline">Ver todas</Link>} />
          {open.length === 0 ? (
            <EmptyState icon={<Ticket className="h-5 w-5" />} title="No tienes solicitudes abiertas" description="Cuando pidas algo, podrás seguirlo aquí en tiempo real." />
          ) : <div className="divide-y divide-border">{open.map((t) => <SimpleTicketRow key={t.id} t={t} />)}</div>}
          {recent.length > 0 && (
            <div className="border-t border-border px-5 py-3">
              <p className="mb-2 text-xs font-medium text-muted">Cerradas recientemente</p>
              {recent.map((t) => (
                <Link key={t.id} href={`/tickets/${t.id}`} className="flex items-center gap-2 py-1 text-sm text-muted hover:text-fg">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span className="flex-1 truncate">{t.title}</span>
                  {t.csatScore ? <span className="flex items-center gap-0.5 text-xs"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{t.csatScore}</span> : null}
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Artículos recomendados" action={<Link href="/help" className="text-xs text-primary hover:underline">Centro de ayuda</Link>} />
          <div className="divide-y divide-border">
            {articles.map((a) => (
              <Link key={a.slug} href={`/help/${a.slug}`} className="flex gap-3 px-5 py-3 hover:bg-subtle">
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0"><span className="block text-sm font-medium">{a.title}</span><span className="line-clamp-1 text-xs text-muted">{a.summary}</span></span>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================ Agente
async function AgentHome({ ctx }: { ctx: Ctx }) {
  const teamIds = (await db.teamMember.findMany({ where: { userId: ctx.user.id }, select: { teamId: true } })).map((t) => t.teamId);
  const open = { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] as ("NEW" | "ASSIGNED" | "IN_PROGRESS" | "PENDING")[] };
  const inc = { requester: { select: { name: true } }, assignee: { select: { name: true } } };
  const [stats, mine, unassigned, atRisk, activity] = await Promise.all([
    agentStats(ctx),
    db.ticket.findMany({ where: { orgId: ctx.orgId, assigneeId: ctx.user.id, status: open }, include: inc, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], take: 8 }),
    db.ticket.findMany({ where: { orgId: ctx.orgId, assigneeId: null, teamId: { in: teamIds }, status: open, approvalStatus: { not: "PENDING" } }, include: inc, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], take: 5 }),
    riskRanking(ctx, { assigneeId: ctx.user.id, teamIds, take: 6 }),
    db.ticketActivity.findMany({ where: { ticket: { orgId: ctx.orgId, OR: [{ assigneeId: ctx.user.id }, { teamId: { in: teamIds } }] } }, include: { actor: { select: { name: true } }, ticket: { select: { id: true, number: true, type: true, title: true } } }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted">{greeting()}, {ctx.user.name.split(" ")[0]}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Tu día de un vistazo</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/queue?view=unassigned" className={buttonClass("outline")}>Tomar tickets sin asignar</Link>
          <Link href="/new/issue" className={buttonClass("primary")}>Registrar incidente</Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Asignados a mí" value={stats.open} icon={<Ticket className="h-4 w-4" />} />
        <Stat label="Resueltos (30 días)" value={stats.resolved30} icon={<CheckCircle2 className="h-4 w-4" />} />
        <Stat label="Cumplimiento SLA" value={stats.sla != null ? `${stats.sla}%` : "—"} tone={stats.sla == null ? undefined : stats.sla >= 90 ? "good" : stats.sla >= 75 ? "warn" : "bad"} icon={<Timer className="h-4 w-4" />} />
        <Stat label="Tiempo medio resolución" value={formatMinutes(stats.mttr)} icon={<Clock className="h-4 w-4" />} />
        <Stat label="Satisfacción" value={stats.csat ? `${stats.csat.toFixed(1)}/5` : "—"} sub={`${stats.csatCount} evaluaciones`} icon={<Star className="h-4 w-4" />} />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Riesgo de incumplir el SLA" description="Predicción según tiempo consumido, carga y estado · tuyos y de tus equipos" action={<Link href="/queue?view=breaching" className="text-xs text-primary hover:underline">Ver todos</Link>} />
            <RiskList items={atRisk} />
          </Card>
          <Card>
            <CardHeader title="Mis tickets asignados" description="Ordenados por prioridad" action={<Link href="/queue?view=mine" className="text-xs text-primary hover:underline">Abrir bandeja</Link>} />
            {mine.length === 0 ? <EmptyState icon={<Ticket className="h-5 w-5" />} title="No tienes tickets asignados" /> :
              <div className="divide-y divide-border">{mine.map((t) => <AgentTicketRow key={t.id} t={t} showAssignee={false} />)}</div>}
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Sin asignar en mis equipos" />
            {unassigned.length === 0 ? <p className="px-5 py-6 text-center text-sm text-muted">Nada pendiente 🎉</p> :
              <div className="divide-y divide-border">{unassigned.map((t) => (
                <Link key={t.id} href={`/tickets/${t.id}`} className="block px-5 py-3 hover:bg-subtle">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-muted">{ticketRef(t.type, t.number)} · {t.priority} · {timeAgo(t.createdAt)}</p>
                </Link>))}</div>}
          </Card>
          <Card>
            <CardHeader title="Actividad reciente" />
            <ul className="space-y-3 px-5 py-4">
              {activity.map((a) => (
                <li key={a.id} className="text-sm">
                  <Link href={`/tickets/${a.ticket.id}`} className="hover:underline"><span className="font-medium">{a.actor?.name ?? "Sistema"}</span> <span className="text-muted">{ACT[a.action] ?? a.action}</span> {ticketRef(a.ticket.type, a.ticket.number)}</Link>
                  <p className="text-xs text-muted">{timeAgo(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

const ACT: Record<string, string> = { created: "creó", status: "cambió el estado de", assigned: "asignó", priority: "cambió la prioridad de", escalated: "escaló", approval: "registró aprobación en", reopened: "reabrió", csat: "evaluó", classified: "clasificó", category: "recategorizó", sla: "alerta SLA en" };

// ============================================================ Gestor / Administrador
async function ManagerHome({ ctx }: { ctx: Ctx }) {
  const m = await getMetrics(ctx, {});
  const k = m.kpis;
  const slaTone = k.slaCompliance == null ? undefined : k.slaCompliance >= 90 ? "good" : k.slaCompliance >= 75 ? "warn" : "bad";
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted">{greeting()}, {ctx.user.name.split(" ")[0]} · últimos 30 días</p>
          <h1 className="text-2xl font-semibold tracking-tight">Panel ejecutivo</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/queue" className={buttonClass("outline")}>Bandeja de trabajo</Link>
          <Link href="/reports" className={buttonClass("primary")}>Reportes completos</Link>
        </div>
      </div>
      {m.alerts.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {m.alerts.map((a, i) => (
            <div key={i} className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm ${a.kind === "danger" ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" : a.kind === "warning" ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" : "border-border bg-card"}`}>
              {a.kind === "info" ? <HelpCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{a.text}
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Incidentes abiertos" value={k.openIncidents} />
        <Stat label="Solicitudes pendientes" value={k.pendingRequests} sub={`${k.awaitingApproval} esperan aprobación`} />
        <Stat label="Cumplimiento SLA" value={k.slaCompliance != null ? `${k.slaCompliance}%` : "—"} tone={slaTone} sub={`Respuesta: ${k.responseCompliance ?? "—"}%`} />
        <Stat label="MTTR" value={formatMinutes(k.mttrMinutes)} sub="Tiempo medio de resolución" />
        <Stat label="Tiempo medio de respuesta" value={formatMinutes(k.mttaMinutes)} />
        <Stat label="Satisfacción (CSAT)" value={k.csat ? `${k.csat.toFixed(1)}/5` : "—"} sub={`${k.csatPositive ?? "—"}% positivas · ${k.csatResponses} resp.`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Volumen de tickets" description={`${k.created} creados · ${k.resolved} resueltos`} />
          <div className="p-5"><TrendChart data={m.trend} /></div>
        </Card>
        <Card>
          <CardHeader title="Cumplimiento por equipo" description="SLA de resolución" />
          <div className="p-5">{m.complianceByTeam.length ? <ComplianceChart data={m.complianceByTeam} /> : <p className="text-sm text-muted">Sin datos</p>}</div>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Rendimiento del equipo" action={<Link href="/reports" className="text-xs text-primary hover:underline">Detalle</Link>} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted"><tr className="border-b border-border"><th className="px-5 py-2 text-left font-medium">Agente</th><th className="px-3 py-2 text-right font-medium">Abiertos</th><th className="px-3 py-2 text-right font-medium">Resueltos</th><th className="px-5 py-2 text-right font-medium">SLA vencido</th></tr></thead>
              <tbody>{m.workload.map((w) => (
                <tr key={w.id} className="border-b border-border last:border-0"><td className="px-5 py-2.5">{w.name}</td><td className="px-3 text-right tabular-nums">{w.open}</td><td className="px-3 text-right tabular-nums">{w.resolved}</td><td className="px-5 text-right">{w.breached ? <Badge tone="red">{w.breached}</Badge> : <span className="text-muted">0</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Incidentes recurrentes" description="Categorías con más incidentes en el período" />
          <ul className="divide-y divide-border">{m.recurring.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-5 py-2.5 text-sm"><span>{r.name}</span><span className="flex items-center gap-2"><span className="tabular-nums font-medium">{r.count}</span>{r.reopened > 0 && <Badge tone="amber">{r.reopened} reabiertos</Badge>}</span></li>
          ))}</ul>
        </Card>
      </div>
    </div>
  );
}
