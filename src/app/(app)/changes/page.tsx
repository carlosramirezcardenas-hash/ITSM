import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, CalendarDays, GitPullRequestArrow, Plus } from "lucide-react";
import { requireCtx } from "@/server/auth";
import { listChanges } from "@/server/changes";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { CHANGE_STATUS_LABEL, CHANGE_STATUS_TONE, CHANGE_TYPE_LABEL, CHANGE_TYPE_TONE, LEVEL_LABEL, OUTCOME_LABEL, OUTCOME_TONE, RISK_TONE } from "@/lib/labels";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Cambios" };
export const dynamic = "force-dynamic";

export default async function ChangesPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string; q?: string }> }) {
  const ctx = await requireCtx("changes:create");
  const sp = await searchParams;
  const tabs: [string, string][] = [["active", "En curso"], ...(can(ctx.user.role, "changes:approve") ? [["mine_approval", "Por aprobar"] as [string, string]] : []), ["CLOSED", "Cerrados"], ["REJECTED", "Rechazados"], ["any", "Todos"]];
  const status = tabs.some(([k]) => k === sp.status) ? sp.status! : "active";
  const items = await listChanges(ctx, { status, type: sp.type, q: sp.q });
  return (
    <div>
      <PageHeader title="Gestión de cambios" description="Planifica, evalúa y aprueba cambios para reducir el riesgo de interrupciones."
        action={<><Link href="/changes/calendar" className={buttonClass("outline")}><CalendarDays className="h-4 w-4" />Calendario</Link><Link href="/changes/new" className={buttonClass()}><Plus className="h-4 w-4" />Nuevo cambio</Link></>} />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="scrollbar-thin flex gap-1 overflow-x-auto">
          {tabs.map(([k, l]) => <Link key={k} href={`/changes?status=${k}`} className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", status === k ? "bg-primary-soft font-medium text-primary" : "text-muted hover:text-fg")}>{l}</Link>)}
        </div>
        <div className="flex gap-1.5">
          {["", "STANDARD", "NORMAL", "EMERGENCY"].map((t) => <Link key={t} href={`/changes?status=${status}${t ? `&type=${t}` : ""}`} className={cn("rounded-full border px-3 py-1 text-xs", (sp.type ?? "") === t ? "border-primary bg-primary-soft text-primary" : "border-border text-muted")}>{t ? CHANGE_TYPE_LABEL[t] : "Todos los tipos"}</Link>)}
        </div>
      </div>
      <Card>
        {items.length === 0 ? <EmptyState icon={<GitPullRequestArrow className="h-5 w-5" />} title="No hay cambios en esta vista" /> : (
          <ul className="divide-y divide-border">
            {items.map((c) => (
              <li key={c.id}>
                <Link href={`/changes/${c.id}`} className="flex flex-col gap-2 px-5 py-3.5 hover:bg-subtle md:flex-row md:items-center">
                  <span className="w-20 font-mono text-xs text-muted">CHG-{c.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">{c.type === "EMERGENCY" && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}<span className="truncate">{c.title}</span></span>
                    <span className="text-xs text-muted">{c.plannedStart ? `${formatDateTime(c.plannedStart)} → ${formatDateTime(c.plannedEnd)}` : "Sin ventana"} · {c.owner?.name ?? "—"} · {c._count.configItems} elemento(s)</span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone={CHANGE_TYPE_TONE[c.type]}>{CHANGE_TYPE_LABEL[c.type]}</Badge>
                    <Badge tone={RISK_TONE[c.risk]}>Riesgo {LEVEL_LABEL[c.risk]!.toLowerCase()}</Badge>
                    <Badge tone={CHANGE_STATUS_TONE[c.status]} dot>{CHANGE_STATUS_LABEL[c.status]}</Badge>
                    {c.outcome && <Badge tone={OUTCOME_TONE[c.outcome]}>{OUTCOME_LABEL[c.outcome]}</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
