import Link from "next/link";
import type { Metadata } from "next";
import { Inbox, Search } from "lucide-react";
import { requireCtx } from "@/server/auth";
import { listTickets } from "@/server/tickets";
import { Card, EmptyState, PageHeader, Select, buttonClass } from "@/components/ui";
import { AgentTicketRow } from "@/components/ticket-list";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bandeja de trabajo" };
export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "mine", label: "Asignados a mí" },
  { key: "team", label: "Mis equipos" },
  { key: "unassigned", label: "Sin asignar" },
  { key: "breaching", label: "SLA en riesgo" },
  { key: "all", label: "Todos" },
] as const;

export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx("tickets:work");
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : "mine";
  const params = { view, type: sp.type || undefined, status: sp.status || "open", priority: sp.priority || undefined, q: sp.q || undefined, page: sp.page ?? 1 };
  const { items, total, page, pageSize } = await listTickets(ctx, params);
  const pages = Math.ceil(total / pageSize);
  const qs = (over: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...over })) if (v !== undefined && v !== "" && !(k === "page" && Number(v) === 1)) u.set(k, String(v));
    return `/queue?${u}`;
  };
  return (
    <div>
      <PageHeader title="Bandeja de trabajo" description={`${total} ticket(s) en esta vista`} action={<Link href="/new/issue" className={buttonClass()}>Registrar incidente</Link>} />
      <div className="scrollbar-thin mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {VIEWS.map((v) => (
          <Link key={v.key} href={qs({ view: v.key, page: 1 })} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", view === v.key ? "border-primary font-medium" : "border-transparent text-muted hover:text-fg")}>{v.label}</Link>
        ))}
      </div>
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
        <input type="hidden" name="view" value={view} />
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input name="q" defaultValue={sp.q} placeholder="Buscar por título o número (INC-1020)" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring" />
        </div>
        <Select name="type" defaultValue={sp.type ?? ""} aria-label="Tipo"><option value="">Todos los tipos</option><option value="INCIDENT">Incidentes</option><option value="REQUEST">Solicitudes</option></Select>
        <Select name="status" defaultValue={params.status} aria-label="Estado">
          <option value="open">Abiertos</option><option value="NEW">Nuevo</option><option value="ASSIGNED">Asignado</option><option value="IN_PROGRESS">En progreso</option>
          <option value="PENDING">Pendiente</option><option value="RESOLVED">Resuelto</option><option value="CLOSED">Cerrado</option><option value="any">Cualquiera</option>
        </Select>
        <Select name="priority" defaultValue={sp.priority ?? ""} aria-label="Prioridad"><option value="">Toda prioridad</option><option value="P1">P1 Crítica</option><option value="P2">P2 Alta</option><option value="P3">P3 Media</option><option value="P4">P4 Baja</option></Select>
        <button className={buttonClass("secondary")}>Filtrar</button>
      </form>
      <Card>
        <div className="hidden grid-cols-[90px_1fr_auto_auto_auto] gap-3 border-b border-border px-5 py-2 text-xs font-medium text-muted md:grid">
          <span>Número</span><span>Título</span><span>Prioridad</span><span>Estado</span><span>SLA · Responsable</span>
        </div>
        {items.length === 0 ? <EmptyState icon={<Inbox className="h-5 w-5" />} title="Bandeja vacía" description="No hay tickets que coincidan con estos filtros." /> :
          <div className="divide-y divide-border">{items.map((t) => <AgentTicketRow key={t.id} t={t} />)}</div>}
      </Card>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>Página {page} de {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className={buttonClass("outline", "sm")} href={qs({ page: page - 1 })}>Anterior</Link>}
            {page < pages && <Link className={buttonClass("outline", "sm")} href={qs({ page: page + 1 })}>Siguiente</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
