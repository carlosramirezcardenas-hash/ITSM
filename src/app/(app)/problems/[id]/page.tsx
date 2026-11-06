import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, BookOpen, GitPullRequestArrow, Network } from "lucide-react";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { AppError } from "@/server/errors";
import { getProblem } from "@/server/problems";
import { getLogs } from "@/server/worklog";
import { Badge, Card, CardHeader, buttonClass } from "@/components/ui";
import { PriorityBadge, StatusBadge } from "@/components/ticket-bits";
import { WorkLog } from "@/components/worklog";
import { CHANGE_STATUS_LABEL, CI_TYPE_LABEL, PROBLEM_STATUS_LABEL, PROBLEM_STATUS_TONE } from "@/lib/labels";
import { PROBLEM_FLOW } from "@/lib/itsm";
import { formatDateTime, ticketRef, timeAgo } from "@/lib/utils";
import { IncidentLinker, ProblemActions, RcaEditor, Tasks, UnlinkButton } from "./problem-client";

export const metadata: Metadata = { title: "Problema" };
export const dynamic = "force-dynamic";

export default async function ProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("problems:manage");
  const { id } = await params;
  let p;
  try { p = await getProblem(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const [logs, staff] = await Promise.all([
    getLogs(ctx.orgId, "problem", id),
    db.user.findMany({ where: { orgId: ctx.orgId, isActive: true, role: { in: ["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const openIncidents = p.incidents.filter((i) => !["RESOLVED", "CLOSED"].includes(i.status)).length;
  const closed = p.status === "CLOSED";
  return (
    <div>
      <Link href="/problems" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Problemas</Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm text-muted"><span className="font-mono">PRB-{p.number}</span> · {p.category?.name ?? "Sin categoría"} · creado por {p.createdBy.name} {timeAgo(p.createdAt)}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{p.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2"><Badge tone={PROBLEM_STATUS_TONE[p.status]} dot>{PROBLEM_STATUS_LABEL[p.status]}</Badge><PriorityBadge priority={p.priority} /><Badge>{p.incidents.length} incidente(s)</Badge></div>
        </div>
        {!closed && <ProblemActions id={p.id} status={p.status} next={PROBLEM_FLOW[p.status]!} hasWorkaround={!!p.workaround} hasFix={!!p.permanentFix} openIncidents={openIncidents} hasArticle={p.articles.length > 0} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {p.description && <Card className="p-5"><p className="whitespace-pre-wrap text-sm leading-relaxed">{p.description}</p></Card>}
          <RcaEditor id={p.id} disabled={closed} initial={{ rcaMethod: p.rcaMethod ?? "five_whys", rootCause: p.rootCause ?? "", workaround: p.workaround ?? "", permanentFix: p.permanentFix ?? "" }} />
          <Tasks problemId={p.id} disabled={closed} today={new Date().toISOString().slice(0, 10)} staff={staff} tasks={p.tasks.map((t) => ({ id: t.id, title: t.title, owner: t.owner?.name ?? null, dueDate: t.dueDate, done: !!t.doneAt }))} />
          <Card>
            <CardHeader title={`Incidentes vinculados (${p.incidents.length})`} description={openIncidents ? `${openIncidents} siguen abiertos` : "Todos resueltos"} />
            {p.incidents.length > 0 && (
              <ul className="divide-y divide-border">
                {p.incidents.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <Link href={`/tickets/${i.id}`} className="min-w-0 flex-1 hover:underline"><span className="font-mono text-xs text-muted">{ticketRef(i.type, i.number)}</span> {i.title}<span className="block text-xs text-muted">{i.requester.name} · {timeAgo(i.createdAt)}</span></Link>
                    <StatusBadge status={i.status} />
                    {!closed && <UnlinkButton problemId={p.id} ticketId={i.id} />}
                  </li>
                ))}
              </ul>
            )}
            {!closed && <div className="border-t border-border p-4"><IncidentLinker problemId={p.id} /></div>}
          </Card>
          <WorkLog logs={logs} entity="problem" entityId={p.id} />
        </div>
        <aside className="space-y-4">
          <Card className="space-y-2.5 p-4 text-sm">
            <Row label="Responsable">{p.owner?.name ?? "—"}</Row>
            <Row label="Equipo">{p.team?.name ?? "—"}</Row>
            <Row label="Error conocido desde">{p.knownErrorAt ? formatDateTime(p.knownErrorAt) : "—"}</Row>
            <Row label="Resuelto">{p.resolvedAt ? formatDateTime(p.resolvedAt) : "—"}</Row>
          </Card>
          <Card>
            <CardHeader title="Cambios relacionados" action={!closed ? <Link href={`/changes/new?problem=${p.id}`} className="text-xs text-primary hover:underline">Proponer cambio</Link> : undefined} />
            {p.changes.length ? <ul className="divide-y divide-border">{p.changes.map((c) => <li key={c.id}><Link href={`/changes/${c.id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-subtle"><GitPullRequestArrow className="h-4 w-4 text-muted" /><span className="flex-1 truncate">CHG-{c.number} · {c.title}</span><span className="text-xs text-muted">{CHANGE_STATUS_LABEL[c.status]}</span></Link></li>)}</ul>
              : <p className="px-4 py-3 text-xs text-muted">La solución definitiva suele requerir un cambio controlado.</p>}
          </Card>
          <Card>
            <CardHeader title="Elementos de configuración" />
            {p.configItems.length ? <ul className="divide-y divide-border">{p.configItems.map((c) => <li key={c.id}><Link href={`/cmdb/${c.id}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-subtle"><Network className="h-4 w-4 text-muted" />{c.name}<span className="ml-auto text-xs text-muted">{CI_TYPE_LABEL[c.type]}</span></Link></li>)}</ul> : <p className="px-4 py-3 text-xs text-muted">Ninguno</p>}
          </Card>
          {p.articles.length > 0 && (
            <Card>
              <CardHeader title="Conocimiento publicado" />
              <ul className="divide-y divide-border">{p.articles.map((a) => <li key={a.id}><Link href={`/help/${a.slug}`} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-subtle"><BookOpen className="h-4 w-4 text-primary" />{a.title}</Link></li>)}</ul>
            </Card>
          )}
          {closed && <Link href="/problems/new" className={buttonClass("outline", "sm", "w-full")}>Registrar otro problema</Link>}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-muted">{label}</span><span className="text-right">{children}</span></div>;
}
