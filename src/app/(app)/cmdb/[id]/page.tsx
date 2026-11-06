import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requireCtx } from "@/server/auth";
import { AppError } from "@/server/errors";
import { getCI } from "@/server/cmdb";
import { Badge, Card, CardHeader, Stat, buttonClass } from "@/components/ui";
import { StatusBadge } from "@/components/ticket-bits";
import { CHANGE_STATUS_LABEL, CI_STATUS_LABEL, CI_TYPE_LABEL, LEVEL_LABEL, PROBLEM_STATUS_LABEL, REL_LABEL, RISK_TONE } from "@/lib/labels";
import { formatDateTime, ticketRef } from "@/lib/utils";
import { AddRelation, RemoveRelation } from "./relations";

export const metadata: Metadata = { title: "Elemento de configuración" };
export const dynamic = "force-dynamic";

export default async function CIPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("cmdb:view");
  const { id } = await params;
  let c;
  try { c = await getCI(ctx, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const manage = can(ctx.user.role, "cmdb:manage");
  const others = manage ? await db.configItem.findMany({ where: { orgId: ctx.orgId, id: { not: id } }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }) : [];
  const services = c.impacted.filter((x) => x.type === "SERVICE");
  const details: [string, string | number | null][] = [
    ["N° de serie", c.serial], ["Ubicación", c.location], ["IP", c.ipAddress], ["Versión", c.version],
    ["Licencias", c.seats != null ? `${c.seatsUsed ?? 0} de ${c.seats} en uso` : null], ["Vencimiento", c.expiresAt], ["Contacto", c.contact],
  ];
  return (
    <div>
      <Link href="/cmdb" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />CMDB</Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted">{CI_TYPE_LABEL[c.type]}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2"><Badge tone={RISK_TONE[c.criticality]}>Criticidad {LEVEL_LABEL[c.criticality]}</Badge><Badge tone={c.status === "ACTIVE" ? "green" : c.status === "RETIRED" ? "slate" : "amber"} dot>{CI_STATUS_LABEL[c.status]}</Badge></div>
        </div>
        {manage && <Link href={`/cmdb/${c.id}/edit`} className={buttonClass("outline")}><Pencil className="h-4 w-4" />Editar</Link>}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Si falla, afecta a" value={c.impacted.length} sub="elementos dependientes" tone={c.impacted.length ? "warn" : undefined} />
        <Stat label="Servicios afectados" value={services.length} tone={services.some((s) => s.criticality === "HIGH") ? "bad" : undefined} />
        <Stat label="Depende de" value={c.dependencies.length} />
        <Stat label="Incidentes (90 días)" value={c.incidents90} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber-500" />Análisis de impacto</span>} description="Qué se ve afectado si este elemento falla (incluye dependencias indirectas)." />
          {c.impacted.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Ningún elemento depende de este.</p> : (
            <ul className="divide-y divide-border">
              {c.impacted.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-5 py-2.5 text-sm" style={{ paddingLeft: 20 + (x.depth - 1) * 16 }}>
                  <Link href={`/cmdb/${x.id}`} className="min-w-0 flex-1 hover:underline">{x.name}<span className="block text-xs text-muted">{CI_TYPE_LABEL[x.type]}{x.depth > 1 ? ` · a través de ${x.via}` : " · directo"}</span></Link>
                  <Badge tone={RISK_TONE[x.criticality]}>{LEVEL_LABEL[x.criticality]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Relaciones" description="Dependencias directas" />
          <ul className="divide-y divide-border">
            {c.outgoing.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-5 py-2.5 text-sm">
                <ArrowDown className="h-4 w-4 shrink-0 text-muted" />
                <span className="flex-1"><span className="text-muted">{REL_LABEL[r.type]}</span> <Link href={`/cmdb/${r.target.id}`} className="font-medium hover:underline">{r.target.name}</Link> <span className="text-xs text-muted">· {CI_TYPE_LABEL[r.target.type]}</span></span>
                {manage && <RemoveRelation id={r.id} />}
              </li>
            ))}
            {c.incoming.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-5 py-2.5 text-sm">
                <ArrowUp className="h-4 w-4 shrink-0 text-muted" />
                <span className="flex-1"><Link href={`/cmdb/${r.source.id}`} className="font-medium hover:underline">{r.source.name}</Link> <span className="text-muted">{REL_LABEL[r.type]} este elemento</span></span>
                {manage && <RemoveRelation id={r.id} />}
              </li>
            ))}
            {!c.outgoing.length && !c.incoming.length && <li className="px-5 py-4 text-sm text-muted">Sin relaciones registradas.</li>}
          </ul>
          {manage && <div className="border-t border-border p-4"><AddRelation ciId={c.id} others={others} /></div>}
        </Card>
        <Card>
          <CardHeader title="Detalles" />
          <dl className="space-y-2 px-5 py-4 text-sm">
            {c.description && <p className="mb-2 whitespace-pre-wrap">{c.description}</p>}
            <div className="flex justify-between"><dt className="text-muted">Responsable</dt><dd>{c.owner?.name ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Equipo</dt><dd>{c.team?.name ?? "—"}</dd></div>
            {details.filter(([, v]) => v != null && v !== "").map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>)}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Historial operativo" />
          <div className="space-y-4 px-5 py-4 text-sm">
            <div><p className="mb-1 text-xs font-medium text-muted">Tickets no cerrados</p>{c.tickets.length ? c.tickets.map((t) => <Link key={t.id} href={`/tickets/${t.id}`} className="flex items-center justify-between gap-2 py-1 hover:underline"><span className="truncate">{ticketRef(t.type, t.number)} · {t.title}</span><StatusBadge status={t.status} /></Link>) : <p className="text-muted">Ninguno</p>}</div>
            <div><p className="mb-1 text-xs font-medium text-muted">Problemas</p>{c.problems.length ? c.problems.map((p) => <Link key={p.id} href={`/problems/${p.id}`} className="block py-1 hover:underline">PRB-{p.number} · {p.title} <span className="text-xs text-muted">({PROBLEM_STATUS_LABEL[p.status]})</span></Link>) : <p className="text-muted">Ninguno</p>}</div>
            <div><p className="mb-1 text-xs font-medium text-muted">Cambios</p>{c.changes.length ? c.changes.map((x) => <Link key={x.id} href={`/changes/${x.id}`} className="block py-1 hover:underline">CHG-{x.number} · {x.title} <span className="text-xs text-muted">({CHANGE_STATUS_LABEL[x.status]}{x.plannedStart ? ` · ${formatDateTime(x.plannedStart)}` : ""})</span></Link>) : <p className="text-muted">Ninguno</p>}</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
