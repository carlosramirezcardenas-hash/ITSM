import type { Metadata } from "next";
import { Download, Info } from "lucide-react";
import { requireCtx } from "@/server/auth";
import { getMetrics } from "@/server/metrics";
import { Badge, Card, CardHeader, PageHeader, Select, Stat, buttonClass } from "@/components/ui";
import { ComplianceChart, HBarChart, TrendChart } from "@/components/charts";
import { PRIORITY_LABEL } from "@/lib/labels";
import { formatMinutes } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard y reportes" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx("reports:view");
  const sp = await searchParams;
  const clean = Object.fromEntries(Object.entries(sp).filter(([, v]) => v));
  let m;
  try { m = await getMetrics(ctx, clean); } catch { m = await getMetrics(ctx, {}); }
  const k = m.kpis;
  const tone = (v: number | null) => (v == null ? undefined : v >= 90 ? "good" : v >= 75 ? "warn" : "bad");
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
      <Card className="flex items-start gap-3 p-4 text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p><strong className="text-fg">Cambios exitosos y fallidos:</strong> disponible cuando se active el módulo de Gestión de cambios (Fase 2). Los indicadores de esta página se calculan con datos reales de la base de datos.</p>
      </Card>
    </div>
  );
}
