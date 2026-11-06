import Link from "next/link";
import type { Metadata } from "next";
import { Ticket } from "lucide-react";
import { requireCtx } from "@/server/auth";
import { listTickets } from "@/server/tickets";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { SimpleTicketRow } from "@/components/ticket-list";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Mis solicitudes" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "En curso" },
  { key: "RESOLVED", label: "Por confirmar" },
  { key: "CLOSED", label: "Cerradas" },
  { key: "any", label: "Todas" },
] as const;

export default async function MyRequests({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.status) ? sp.status! : "open";
  const { items, total, page, pageSize } = await listTickets(ctx, { view: "requested", status, page: sp.page ?? 1 });
  const pages = Math.ceil(total / pageSize);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Mis solicitudes" description="Sigue en tiempo real todo lo que has pedido." action={<Link href="/new" className={buttonClass()}>Crear solicitud</Link>} />
      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link key={t.key} href={`/my-requests?status=${t.key}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", status === t.key ? "border-primary font-medium text-fg" : "border-transparent text-muted hover:text-fg")}>{t.label}</Link>
        ))}
      </div>
      <Card>
        {items.length === 0 ? <EmptyState icon={<Ticket className="h-5 w-5" />} title="Nada por aquí" description="Cuando crees una solicitud, aparecerá en esta lista." action={<Link href="/new" className={buttonClass("outline", "sm")}>Crear solicitud</Link>} />
          : <div className="divide-y divide-border">{items.map((t) => <SimpleTicketRow key={t.id} t={t} />)}</div>}
      </Card>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>Página {page} de {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className={buttonClass("outline", "sm")} href={`/my-requests?status=${status}&page=${page - 1}`}>Anterior</Link>}
            {page < pages && <Link className={buttonClass("outline", "sm")} href={`/my-requests?status=${status}&page=${page + 1}`}>Siguiente</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
