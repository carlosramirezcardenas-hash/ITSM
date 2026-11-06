import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requireCtx } from "@/server/auth";
import { getItsmMetrics, getMetrics } from "@/server/metrics";
import Link from "next/link";
import { CHANGE_TYPE_LABEL } from "@/lib/labels";
import { Badge, Card, CardHeader, PageHeader, Select, Stat, buttonClass } from "@/components/ui";
import { ComplianceChart, ForecastChart, HBarChart, TrendChart } from "@/components/charts";
import { riskRanking, ticketForecast } from "@/server/predictive";
import { aiAvailable } from "@/server/ai";
import { AiTrends } from "./ai-trends";
import { RiskList } from "@/components/risk-list";
import { PRIORITY_LABEL } from "@/lib/labels";
import { formatMinutes } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard y reportes" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx("reports:view");
  const sp = await searchParams;
  const clean = Object.fromEntries(Object.entries(sp).filter(([, v]) => v));
  let m, x;
  try { [m, x] = await Promise.all([getMetrics(ctx, clean), getItsmMetrics(ctx, clean)]); } catch { [m, x] = await Promise.all([getMetrics(ctx, {}), getItsmMetrics(ctx, {})]); }
  const k = m.kpis;
  const tone = (v: number | null) => (v == null ? undefined : v >= 90 ? "good" : v >= 75 ? "warn" : "bad");
  const [fc, risk, aiOn] = await Promise.all([ticketForecast(ctx), riskRanking(ctx, { take: 8 }), aiAvailable(ctx.orgId)]);
  const DOW = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const exportQs = new URLSearchParams({ ...clean, from: m.range.from, to: m.range.to }).toString();
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard y reportes" description={`Período ${m.range.from} → ${m.range.to}`}
        action={<a href={`/api/v1/reports/export?${exportQs}`} className={buttonClass("outline")}><Download className="h-4 w-4" />Exportar CSV</a>} />
      <Card className="p-4">
        <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7 lg:items-end">
          <label className="text-xs text-muted">Desde<input type="date" name="from" defaultValue={m.range.from} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm text-fg" /></label>
          <label className="text-xs text-muted">Hasta<input type="date" name="to" defaultValue={m.range.to} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm text-fg" /></label>
          <label className="text-xs text-muted">Equipo<Select name="teamId" defaultValue={sp.teamId ?? ""} className="mt-1"><option value="">Todos</option>{m.options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></label>
          <label className="text-xs text-muted">Categoría<Select name="categoryId" defaultValue={sp.categoryId ?? ""} className="mt-1"><option value="">Todas</option>{m.options.categories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></label>
          <label className="text-xs text-muted">Responsable<Select name="assigneeId" defaultValue={sp.assigneeId ?? ""} className="mt-1"><option value="">Todos</option>{m.options.users.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></label>
          <label className="text-xs text-muted">Tipo<Select name="type" defaultValue={sp.type ?? ""} className="mt-1"><option value="">Todos</option><option value="INCIDENT">Incidentes</option><option value="REQUEST">Solicitudes</option></Select></label>
          <div className="flex gap-2"><button className={buttonClass("primary", "md", "flex-1")}>Aplicar</button><a href="/reports" className={buttonClass("ghost")}>Limpiar</a></div>
        </form>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Incidentes abiertos" value={k.openIncidents} />
        <Stat label="Solicitudes pendientes" value={k.pendingRequests} />
        <Stat label="Creados" value={k.created} />
        <Stat label="Resueltos" value={k.resolved} />
        <Stat label="SLA resolución" value={k.slaCompliance != null ? `${k.slaCompliance}%` : "—"} tone={tone(k.slaCompliance)} />
        <Stat label="SLA respuesta" value={k.responseCompliance != null ? `${k.responseCompliance}%` : "—"} tone={tone(k.responseCompliance)} />
        <Stat label="MTTR" value={formatMinutes(k.mttrMinutes)} />
        <Stat label="CSAT" value={k.csat ? `${k.csat.toFixed(1)}/5` : "—"} sub={`${k.csatResponses} respuestas`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader title="Tendencia" description="Tickets creados vs. resueltos" /><div className="p-5"><TrendChart data={m.trend} /></div></Card>
        <Card><CardHeader title="Abiertos por prioridad" /><div className="p-5"><HBarChart label="Tickets abiertos" data={m.byPriority.map((p) => ({ name: `${p.priority} · ${PRIORITY_LABEL[p.priority]}`, value: p.count }))} /></div></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Cumplimiento de SLA por equipo" /><div className="p-5">{m.complianceByTeam.length ? <ComplianceChart data={m.complianceByTeam} /> : <p className="text-sm text-muted">Sin tickets resueltos con SLA en el período.</p>}</div></Card>
        <Card><CardHeader title="Cumplimiento de SLA por categoría" /><div className="p-5">{m.complianceByCategory.length ? <ComplianceChart data={m.complianceByCategory} /> : <p className="text-sm text-muted">Sin datos.</p>}</div></Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Carga de trabajo por técnico" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted"><tr className="border-b border-border"><th className="px-5 py-2 text-left font-medium">Técnico</th><th className="px-3 text-right font-medium">Abiertos</th><th className="px-3 text-right font-medium">Resueltos</th><th className="px-5 text-right font-medium">Vencidos</th></tr></thead>
              <tbody>{m.workload.map((w) => <tr key={w.id} className="border-b border-border last:border-0"><td className="px-5 py-2.5">{w.name}</td><td className="px-3 text-right tabular-nums">{w.open}</td><td className="px-3 text-right tabular-nums">{w.resolved}</td><td className="px-5 text-right">{w.breached ? <Badge tone="red">{w.breached}</Badge> : "0"}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Incidentes recurrentes" description="Base para identificar problemas de fondo" />
          <div className="p-5">{m.recurring.length ? <HBarChart label="Incidentes" data={m.recurring.map((r) => ({ name: r.name, value: r.count }))} /> : <p className="text-sm text-muted">Sin incidentes en el período.</p>}</div>
        </Card>
      </div>
      <h2 className="pt-2 text-lg font-semibold">Análisis predictivo</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Pronóstico de tickets · próximos 7 días" description={`≈${fc.total} tickets esperados · tendencia ${fc.trend > 1.05 ? "al alza" : fc.trend < 0.95 ? "a la baja" : "estable"} (${Math.round((fc.trend - 1) * 100)}%)`} />
          <div className="p-5">
            <ForecastChart data={fc.forecast.map((f) => ({ label: `${DOW[f.weekday]} ${f.date.slice(8)}`, expected: f.expected, low: f.low, high: f.high }))} />
            <p className="mt-3 text-xs text-muted">
              Modelo: promedio del mismo día de la semana en las últimas 4 semanas × tendencia de los últimos 14 días.
              {fc.capacity > 0 && <> Pico esperado: <strong className="text-fg">≈{fc.peak}</strong> tickets en un día; el máximo resuelto en un día del último mes fue <strong className="text-fg">{fc.capacity}</strong>.{fc.overCapacity ? <span className="font-medium text-amber-600"> El volumen esperado supera la capacidad observada: considera reforzar el equipo.</span> : " La capacidad observada alcanza."}</>}
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Riesgo de incumplir el SLA" description="Tickets abiertos con mayor probabilidad de vencer" />
          <RiskList items={risk} />
        </Card>
      </div>
      <AiTrends filters={clean as Record<string, string>} aiOn={aiOn} />

      <h2 className="pt-2 text-lg font-semibold">Problemas, cambios y CMDB</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Cambios implementados" value={x.changes.implemented} sub={`${x.changes.planned} en el período`} />
        <Stat label="Tasa de éxito" value={x.changes.successRate != null ? `${x.changes.successRate}%` : "—"} tone={tone(x.changes.successRate)} />
        <Stat label="Cambios exitosos" value={x.changes.successful} tone={x.changes.successful ? "good" : undefined} />
        <Stat label="Fallidos o revertidos" value={x.changes.failed} tone={x.changes.failed ? "bad" : undefined} sub={x.changes.partial ? `${x.changes.partial} parciales` : undefined} />
        <Stat label="Cambios de emergencia" value={x.changes.emergency} tone={x.changes.emergency > 2 ? "warn" : undefined} />
        <Stat label="Problemas abiertos" value={x.problems.open} />
        <Stat label="Errores conocidos" value={x.problems.knownErrors} />
        <Stat label="Problemas resueltos" value={x.problems.resolved} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Cambios por tipo" />
          <div className="p-5"><HBarChart label="Cambios" data={x.changes.byType.map((t) => ({ name: CHANGE_TYPE_LABEL[t.type]!, value: t.count }))} /></div>
        </Card>
        <Card>
          <CardHeader title="Activos con más incidentes" description="Candidatos a investigar como problema" />
          {x.topCIs.length ? <ul className="divide-y divide-border">{x.topCIs.map((c) => <li key={c.id}><Link href={`/cmdb/${c.id}`} className="flex justify-between px-5 py-2.5 text-sm hover:bg-subtle"><span>{c.name}</span><span className="font-medium tabular-nums">{c.count}</span></Link></li>)}</ul> : <p className="px-5 py-4 text-sm text-muted">Ningún incidente tiene un elemento de la CMDB asociado en el período.</p>}
        </Card>
        <Card>
          <CardHeader title="Resolución por prioridad" />
          <table className="w-full text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-border"><th className="px-5 py-2 text-left font-medium">Prioridad</th><th className="px-3 text-right font-medium">Resueltos</th><th className="px-3 text-right font-medium">MTTR</th><th className="px-5 text-right font-medium">SLA</th></tr></thead>
            <tbody>{x.mttrByPriority.map((r) => <tr key={r.priority} className="border-b border-border last:border-0"><td className="px-5 py-2">{r.priority} · {PRIORITY_LABEL[r.priority]}</td><td className="px-3 text-right tabular-nums">{r.count}</td><td className="px-3 text-right tabular-nums">{formatMinutes(r.mttr)}</td><td className="px-5 text-right tabular-nums">{r.sla != null ? `${r.sla}%` : "—"}</td></tr>)}</tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
