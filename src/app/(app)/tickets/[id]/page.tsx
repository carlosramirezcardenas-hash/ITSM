import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Check, Clock, Lock, ShieldCheck, ShieldX, Star } from "lucide-react";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requireCtx } from "@/server/auth";
import { AppError } from "@/server/errors";
import { allowedNext, getTicket, similarTickets } from "@/server/tickets";
import { Avatar, Badge, Card, CardHeader } from "@/components/ui";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/ticket-bits";
import { APPROVAL_LABEL, LEVEL_LABEL, PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL, TYPE_USER_LABEL } from "@/lib/labels";
import { cn, formatDateTime, ticketRef, timeAgo } from "@/lib/utils";
import { Composer, ConfirmResolution, StaffPanel } from "./ticket-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Detalle" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  let t;
  try { t = await getTicket(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const staff = can(ctx.user.role, "tickets:work");
  const isRequester = t.requesterId === ctx.user.id;
  const ref = ticketRef(t.type, t.number);
  const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { timezone: true } });
  const tz = org?.timezone;

  const [teams, agents, categories, similar] = staff ? await Promise.all([
    db.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { orgId: ctx.orgId, isActive: true, role: { in: ["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"] } }, select: { id: true, name: true, memberships: { select: { teamId: true } } }, orderBy: { name: "asc" } }),
    db.category.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    similarTickets(ctx, id),
  ]) : [[], [], [], []];

  // Hilo combinado (comentarios + eventos) en orden cronológico
  const thread = [
    ...t.comments.map((c) => ({ kind: "comment" as const, at: c.createdAt, c })),
    ...t.activities.filter((a) => a.action !== "created").map((a) => ({ kind: "event" as const, at: a.createdAt, a })),
  ].sort((x, y) => x.at.getTime() - y.at.getTime());

  const steps = ["NEW", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
  const stepIdx = t.status === "PENDING" ? 2 : steps.indexOf(t.status);
  const stepLabels = ["Recibido", "En revisión", "Trabajando", "Solucionado", "Cerrado"];
  const userView = !staff;

  return (
    <div>
      <Link href={staff ? "/queue" : "/my-requests"} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />{staff ? "Bandeja" : "Mis solicitudes"}</Link>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="font-mono">{ref}</span>·<span>{staff ? TYPE_LABEL[t.type] : TYPE_USER_LABEL[t.type]}</span>
          {t.category && <>·<span>{t.category.name}</span></>}
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{t.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} simple={userView} />
          {staff && <PriorityBadge priority={t.priority} />}
          {staff && <SlaBadge t={t} warnPercent={t.slaPolicy?.warnPercent} />}
          {t.approvalStatus !== "NOT_REQUIRED" && <Badge tone={t.approvalStatus === "APPROVED" ? "green" : t.approvalStatus === "REJECTED" ? "red" : "orange"}>{APPROVAL_LABEL[t.approvalStatus]}</Badge>}
          {t.escalationLevel > 0 && staff && <Badge tone="red">Escalado nivel {t.escalationLevel}</Badge>}
          {t.reopenCount > 0 && staff && <Badge tone="amber">Reabierto ×{t.reopenCount}</Badge>}
          {t.pendingReason && t.status === "PENDING" && <span className="text-xs text-muted">· {t.pendingReason}</span>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {userView && t.approvalStatus !== "REJECTED" && (
            <Card className="p-5">
              <ol className="flex items-center">
                {stepLabels.map((l, i) => (
                  <li key={l} className="flex flex-1 items-center justify-center sm:justify-start sm:last:flex-none">
                    <div className="flex flex-col items-center gap-1.5">
                      <span className={cn("flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold",
                        i < stepIdx || (i === stepIdx && i >= 3) ? "border-primary bg-primary text-primary-fg" : i === stepIdx ? "border-primary text-primary" : "border-border text-muted")}>
                        {i < stepIdx || (i === stepIdx && i >= 3) ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </span>
                      <span className={cn("text-center text-[11px] sm:text-xs", i <= stepIdx ? "font-medium" : "text-muted")}>{l}</span>
                    </div>
                    {i < stepLabels.length - 1 && <span className={cn("mx-1 mb-5 hidden h-0.5 flex-1 rounded sm:block", i < stepIdx ? "bg-primary" : "bg-border")} />}
                  </li>
                ))}
              </ol>
              {t.status === "PENDING" && t.pendingReason && <p className="mt-4 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800 dark:bg-orange-950 dark:text-orange-200">{t.pendingReason === "Esperando respuesta del usuario" ? "Necesitamos información tuya: responde abajo para continuar." : t.pendingReason}.</p>}
            </Card>
          )}

          {isRequester && (t.status === "RESOLVED" || (t.status === "CLOSED" && !t.csatScore && t.approvalStatus !== "REJECTED")) && (
            <ConfirmResolution ticketId={t.id} resolution={t.resolution} status={t.status} />
          )}

          <Card>
            <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
              <Avatar name={t.requester.name} size={32} />
              <div className="min-w-0 text-sm">
                <p className="font-medium">{t.requester.name}</p>
                <p className="text-xs text-muted">{[t.requester.title, t.requester.department?.name].filter(Boolean).join(" · ")} · {formatDateTime(t.createdAt, tz)}</p>
              </div>
            </div>
            <div className="space-y-4 px-5 py-4">
              {t.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.description}</p> : <p className="text-sm text-muted">Sin descripción adicional.</p>}
              {t.answers.length > 0 && (
                <dl className="grid gap-3 rounded-xl bg-subtle p-4 sm:grid-cols-2">
                  {t.answers.map((a) => (
                    <div key={a.key}>
                      <dt className="flex items-center gap-1 text-xs text-muted">{a.label}{a.sensitive && <Lock className="h-3 w-3" aria-label="Dato cifrado" />}</dt>
                      <dd className="text-sm font-medium">{a.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {t.resolution && t.status !== "RESOLVED" && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950">
                  <p className="font-medium text-emerald-800 dark:text-emerald-200">{t.approvalStatus === "REJECTED" ? "Motivo" : "Solución aplicada"}</p>
                  <p className="mt-1 text-emerald-900 dark:text-emerald-100">{t.resolution}</p>
                </div>
              )}
              {t.csatScore && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Evaluación:</span>
                  <span className="flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn("h-4 w-4", n <= t.csatScore! ? "fill-amber-400 text-amber-400" : "text-border-strong")} />)}</span>
                  {t.csatComment && <span className="text-muted">«{t.csatComment}»</span>}
                </div>
              )}
            </div>
          </Card>

          {t.approvals.length > 0 && (
            <Card>
              <CardHeader title="Aprobaciones" />
              <ul className="divide-y divide-border">
                {t.approvals.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    {a.status === "APPROVED" ? <ShieldCheck className="h-4 w-4 text-emerald-500" /> : a.status === "REJECTED" ? <ShieldX className="h-4 w-4 text-red-500" /> : <Clock className="h-4 w-4 text-orange-500" />}
                    <span className="flex-1"><strong>{a.approver.name}</strong> · {APPROVAL_LABEL[a.status]}{a.comment ? ` — «${a.comment}»` : ""}</span>
                    <span className="text-xs text-muted">{a.decidedAt ? timeAgo(a.decidedAt) : "pendiente"}</span>
                  </li>
                ))}
              </ul>
              {t.approvals.some((a) => a.status === "PENDING" && a.approver.id === ctx.user.id) && (
                <div className="border-t border-border px-5 py-3"><Link href="/approvals" className="text-sm font-medium text-primary hover:underline">Decidir en Aprobaciones →</Link></div>
              )}
            </Card>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold">Conversación y actividad</h2>
            <ol className="space-y-3">
              {thread.map((item) => item.kind === "comment" ? (
                <li key={item.c.id} className={cn("rounded-xl border p-4", item.c.isInternal ? "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/40" : "border-border bg-card")}>
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <Avatar name={item.c.author.name} size={24} />
                    <span className="font-medium">{item.c.author.name}</span>
                    {can(item.c.author.role, "tickets:work") && <Badge tone="primary">Soporte</Badge>}
                    {item.c.isInternal && <Badge tone="amber"><Lock className="h-3 w-3" />Nota interna</Badge>}
                    <span className="ml-auto text-xs text-muted" title={formatDateTime(item.c.createdAt, tz)}>{timeAgo(item.c.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.c.body}</p>
                </li>
              ) : (
                <li key={item.a.id} className="flex items-center gap-2 px-2 text-xs text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />
                  <span><strong className="font-medium text-fg/80">{item.a.actor?.name ?? "Sistema"}</strong> {describe(item.a, staff)}</span>
                  <span className="ml-auto shrink-0">{timeAgo(item.a.createdAt)}</span>
                </li>
              ))}
            </ol>
            {t.status !== "CLOSED" && (isRequester || staff) && <div className="mt-4"><Composer ticketId={t.id} staff={staff} /></div>}
            {t.status === "CLOSED" && <p className="mt-4 rounded-lg bg-subtle px-4 py-3 text-sm text-muted">Este ticket está cerrado. {isRequester && "Si el problema volvió, puedes reabrirlo dentro de 14 días."}</p>}
          </section>
        </div>

        <aside className="space-y-4">
          {staff ? (
            <StaffPanel
              key={t.updatedAt.toISOString()}
              ticket={{ id: t.id, status: t.status, assigneeId: t.assigneeId, teamId: t.teamId, impact: t.impact, urgency: t.urgency, priority: t.priority, categoryId: t.categoryId, approvalPending: t.approvalStatus === "PENDING", resolution: t.resolution }}
              next={allowedNext(t.status)} teams={teams} categories={categories}
              agents={agents.map((a) => ({ id: a.id, name: a.name, teamIds: a.memberships.map((m) => m.teamId) }))} me={ctx.user.id}
            />
          ) : null}
          <Card className="space-y-3 p-4 text-sm">
            <Row label="Responsable">{t.assignee ? <span className="flex items-center gap-1.5"><Avatar name={t.assignee.name} size={20} />{t.assignee.name}</span> : <span className="text-muted">Por asignar</span>}</Row>
            <Row label="Equipo">{t.team?.name ?? "—"}</Row>
            {staff && <Row label="Impacto / urgencia">{LEVEL_LABEL[t.impact]} / {LEVEL_LABEL[t.urgency]}</Row>}
            {staff && <Row label="Política SLA">{t.slaPolicy?.name ?? "—"}</Row>}
            {staff && <Row label="Primera respuesta">{t.firstResponseAt ? formatDateTime(t.firstResponseAt, tz) : <span className={t.responseBreached ? "text-red-600" : ""}>vence {formatDateTime(t.responseDueAt, tz)}</span>}</Row>}
            {staff && <Row label="Resolución">{t.resolvedAt ? formatDateTime(t.resolvedAt, tz) : t.slaPausedAt ? "En pausa" : `vence ${formatDateTime(t.resolutionDueAt, tz)}`}</Row>}
            {!staff && t.serviceItem && <Row label="Tiempo estimado">~{t.serviceItem.estimatedHours < 24 ? `${t.serviceItem.estimatedHours} h` : `${Math.round(t.serviceItem.estimatedHours / 24)} días`}</Row>}
            {!staff && <Row label="Prioridad">{PRIORITY_LABEL[t.priority]}</Row>}
            <Row label="Creado">{formatDateTime(t.createdAt, tz)}</Row>
            <Row label="Canal">{t.channel}</Row>
          </Card>
          {staff && similar.length > 0 && (
            <Card>
              <CardHeader title="Tickets similares" description="Posibles duplicados o problema recurrente" />
              <ul className="divide-y divide-border">
                {similar.map((s) => (
                  <li key={s.id}><Link href={`/tickets/${s.id}`} className="block px-4 py-2.5 hover:bg-subtle">
                    <p className="truncate text-sm">{s.title}</p>
                    <p className="text-xs text-muted">{ticketRef(s.type, s.number)} · {STATUS_LABEL[s.status]} · {Math.round(s.score * 100)}% similar</p>
                  </Link></li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><span className="text-muted">{label}</span><span className="text-right">{children}</span></div>;
}

function describe(a: { action: string; fromValue: string | null; toValue: string | null; note: string | null }, staff: boolean) {
  const S = (v: string | null) => (v ? STATUS_LABEL[v] ?? v : "—");
  const note = a.note ? ` — ${a.note}` : "";
  switch (a.action) {
    case "status": return `cambió el estado de ${S(a.fromValue)} a ${S(a.toValue)}${note}`;
    case "assigned": return a.toValue ? `asignó a ${a.toValue}${staff ? note : ""}` : "dejó el ticket sin responsable";
    case "priority": return `cambió la prioridad de ${a.fromValue} a ${a.toValue}`;
    case "escalated": return `escaló el ticket${a.toValue && isNaN(Number(a.toValue)) ? ` a ${a.toValue}` : ` (nivel ${a.toValue})`}${note}`;
    case "approval": return a.toValue === "PENDING" ? "solicitó aprobación" : a.toValue === "APPROVED" ? `aprobó la solicitud${note}` : `rechazó la solicitud${note}`;
    case "reopened": return `reabrió el ticket${note}`;
    case "classified": return `clasificó como «${a.toValue}»${note}`;
    case "category": return `cambió la categoría a «${a.toValue}»`;
    case "csat": return `evaluó la atención con ${a.toValue}/5`;
    case "sla": return a.note ?? "alerta de SLA";
    default: return a.action;
  }
}
