import Link from "next/link";
import type { Metadata } from "next";
import { Bug, Plus, Search } from "lucide-react";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { listProblems } from "@/server/problems";
import { Badge, Card, EmptyState, PageHeader, Stat, buttonClass } from "@/components/ui";
import { PriorityBadge } from "@/components/ticket-bits";
import { PROBLEM_STATUS_LABEL, PROBLEM_STATUS_TONE } from "@/lib/labels";
import { cn, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Problemas" };
export const dynamic = "force-dynamic";

const TABS = [["open", "Abiertos"], ["KNOWN_ERROR", "Errores conocidos"], ["RESOLVED", "Resueltos"], ["CLOSED", "Cerrados"], ["any", "Todos"]] as const;

export default async function ProblemsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await requireCtx("problems:manage");
  const sp = await searchParams;
  const status = TABS.some(([k]) => k === sp.status) ? sp.status! : "open";
  const items = await listProblems(ctx, { status, q: sp.q });
  // Candidatos: categorías con incidentes repetidos (30 días) sin problema asociado
  const since = new Date(Date.now() - 30 * 86400_000);
  const groups = await db.ticket.groupBy({ by: ["categoryId"], where: { orgId: ctx.orgId, type: "INCIDENT", problemId: null, createdAt: { gt: since }, categoryId: { not: null } }, _count: { _all: true }, orderBy: { _count: { categoryId: "desc" } }, take: 3 });
  const cats = await db.category.findMany({ where: { id: { in: groups.map((g) => g.categoryId!) } }, select: { id: true, name: true } });
  const candidates = groups.filter((g) => g._count._all >= 4).map((g) => ({ ...g, name: cats.find((c) => c.id === g.categoryId)?.name }));
  const [open, known, incidents] = await Promise.all([
    db.problem.count({ where: { orgId: ctx.orgId, status: { in: ["NEW", "INVESTIGATING"] } } }),
    db.problem.count({ where: { orgId: ctx.orgId, status: "KNOWN_ERROR" } }),
    db.ticket.count({ where: { orgId: ctx.orgId, problemId: { not: null }, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] } } }),
  ]);
  return (
    <div>
      <PageHeader title="Gestión de problemas" description="Encuentra la causa raíz de los incidentes recurrentes y evita que vuelvan a ocurrir." action={<Link href="/problems/new" className={buttonClass()}><Plus className="h-4 w-4" />Registrar problema</Link>} />
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="En análisis" value={open} />
        <Stat label="Errores conocidos" value={known} sub="con solución temporal" />
        <Stat label="Incidentes abiertos vinculados" value={incidents} />
      </div>
      {candidates.length > 0 && (
        <Card className="mb-6 border-amber-200 p-4 dark:border-amber-900">
          <p className="text-sm font-medium">Posibles problemas detectados</p>
          <p className="text-xs text-muted">Categorías con muchos incidentes en los últimos 30 días que no están asociados a un problema.</p>
          <ul className="mt-3 space-y-2">
            {candidates.map((c) => (
              <li key={c.categoryId} className="flex items-center justify-between gap-3 text-sm">
                <span><strong>{c._count._all}</strong> incidentes en «{c.name}»</span>
                <Link href={`/problems/new?category=${c.categoryId}`} className={buttonClass("outline", "sm")}>Investigar</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-border md:border-0">
          {TABS.map(([k, l]) => <Link key={k} href={`/problems?status=${k}`} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm md:rounded-lg md:border-0 md:py-1.5", status === k ? "border-primary font-medium md:bg-primary-soft md:text-primary" : "border-transparent text-muted hover:text-fg")}>{l}</Link>)}
        </div>
        <form className="relative md:w-72">
          <input type="hidden" name="status" value={status} />
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input name="q" defaultValue={sp.q} placeholder="Buscar (PRB-101, causa…)" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring" />
        </form>
      </div>
      <Card>
        {items.length === 0 ? <EmptyState icon={<Bug className="h-5 w-5" />} title="Sin problemas en esta vista" /> : (
          <ul className="divide-y divide-border">
            {items.map((p) => (
              <li key={p.id}>
                <Link href={`/problems/${p.id}`} className="flex flex-col gap-2 px-5 py-3.5 hover:bg-subtle sm:flex-row sm:items-center">
                  <span className="w-20 font-mono text-xs text-muted">PRB-{p.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.title}</span>
                    <span className="text-xs text-muted">{p.category?.name ?? "Sin categoría"} · {p._count.incidents} incidente(s) · {p.owner?.name ?? "sin responsable"} · {timeAgo(p.updatedAt)}</span>
                  </span>
                  <span className="flex gap-1.5"><PriorityBadge priority={p.priority} /><Badge tone={PROBLEM_STATUS_TONE[p.status]} dot>{PROBLEM_STATUS_LABEL[p.status]}</Badge></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
