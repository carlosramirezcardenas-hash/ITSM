import Link from "next/link";
import type { Metadata } from "next";
import { Network, Plus, Search } from "lucide-react";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requireCtx } from "@/server/auth";
import { CI_TYPES, listCIs } from "@/server/cmdb";
import { Badge, Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { CI_STATUS_LABEL, CI_TYPE_LABEL, CI_TYPE_PLURAL, LEVEL_LABEL, RISK_TONE } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "CMDB" };
export const dynamic = "force-dynamic";

export default async function CmdbPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string; status?: string }> }) {
  const ctx = await requireCtx("cmdb:view");
  const sp = await searchParams;
  const [items, counts] = await Promise.all([
    listCIs(ctx, sp),
    db.configItem.groupBy({ by: ["type"], where: { orgId: ctx.orgId }, _count: { _all: true } }),
  ]);
  const soon = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const total = counts.reduce((a, c) => a + c._count._all, 0);
  return (
    <div>
      <PageHeader title="CMDB — Inventario de activos y servicios" description="Qué tienes, quién es responsable y qué depende de qué."
        action={can(ctx.user.role, "cmdb:manage") ? <Link href="/cmdb/new" className={buttonClass()}><Plus className="h-4 w-4" />Nuevo elemento</Link> : undefined} />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="scrollbar-thin flex gap-1 overflow-x-auto">
          <Link href="/cmdb" className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", !sp.type ? "bg-primary-soft font-medium text-primary" : "text-muted hover:text-fg")}>Todos <span className="text-xs opacity-70">{total}</span></Link>
          {CI_TYPES.map((t) => { const n = counts.find((c) => c.type === t)?._count._all ?? 0; return n ? <Link key={t} href={`/cmdb?type=${t}`} className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", sp.type === t ? "bg-primary-soft font-medium text-primary" : "text-muted hover:text-fg")}>{CI_TYPE_PLURAL[t]} <span className="text-xs opacity-70">{n}</span></Link> : null; })}
        </div>
        <form className="relative lg:w-72">
          {sp.type && <input type="hidden" name="type" value={sp.type} />}
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input name="q" defaultValue={sp.q} placeholder="Nombre, serie, IP, ubicación…" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring" />
        </form>
      </div>
      <Card className="overflow-x-auto">
        {items.length === 0 ? <EmptyState icon={<Network className="h-5 w-5" />} title="Sin elementos" description="Registra servidores, aplicaciones y servicios para analizar el impacto de las fallas." /> : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-xs text-muted"><tr className="border-b border-border"><th className="px-5 py-2.5 text-left font-medium">Elemento</th><th className="px-3 text-left font-medium">Tipo</th><th className="px-3 text-left font-medium">Criticidad</th><th className="px-3 text-left font-medium">Responsable</th><th className="px-3 text-right font-medium">Relaciones</th><th className="px-5 text-right font-medium">Incidentes abiertos</th></tr></thead>
            <tbody>{items.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-subtle/60">
                <td className="px-5 py-2.5"><Link href={`/cmdb/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                  <span className="block text-xs text-muted">{[c.version, c.ipAddress, c.location].filter(Boolean).join(" · ") || c.description?.slice(0, 60)}</span>
                  {c.status !== "ACTIVE" && <Badge tone={c.status === "RETIRED" ? "slate" : "amber"}>{CI_STATUS_LABEL[c.status]}</Badge>}
                  {c.expiresAt && c.expiresAt <= soon && <Badge tone={c.expiresAt < today ? "red" : "amber"}>{c.expiresAt < today ? "Vencido" : "Vence"} {c.expiresAt}</Badge>}
                </td>
                <td className="px-3 text-muted">{CI_TYPE_LABEL[c.type]}</td>
                <td className="px-3"><Badge tone={RISK_TONE[c.criticality]}>{LEVEL_LABEL[c.criticality]}</Badge></td>
                <td className="px-3 text-muted">{c.owner?.name ?? c.team?.name ?? "—"}</td>
                <td className="px-3 text-right tabular-nums text-muted">{c._count.incoming + c._count.outgoing}</td>
                <td className="px-5 text-right">{c._count.tickets ? <Badge tone="red">{c._count.tickets}</Badge> : <span className="text-muted">0</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
