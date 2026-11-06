import Link from "next/link";
import type { Metadata } from "next";
import { Clock, Search, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { DynIcon } from "@/components/icon";
import { EmptyState, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Catálogo de servicios" };

const eta = (h: number) => (h < 24 ? `${h} h` : `${Math.round(h / 24)} día${Math.round(h / 24) > 1 ? "s" : ""}`);

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string }> }) {
  const ctx = await requireCtx();
  const { c, q } = await searchParams;
  const categories = await db.category.findMany({ where: { orgId: ctx.orgId, services: { some: { isActive: true } } }, orderBy: { name: "asc" } });
  const cat = c === "access" ? categories.find((x) => /acceso/i.test(x.name)) : categories.find((x) => x.id === c);
  const services = await db.serviceItem.findMany({
    where: {
      orgId: ctx.orgId, isActive: true,
      ...(cat ? { categoryId: cat.id } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: { category: true },
    orderBy: [{ popularity: "desc" }, { name: "asc" }],
  });
  return (
    <div>
      <PageHeader title="Catálogo de servicios" description="Elige lo que necesitas. Te mostramos cuánto demora y si requiere aprobación." />
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
        <form className="relative md:w-72">
          {cat && <input type="hidden" name="c" value={cat.id} />}
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input name="q" defaultValue={q} placeholder="Buscar en el catálogo" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring" />
        </form>
        <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <Link href="/catalog" className={cn("rounded-full border px-3 py-1 text-sm whitespace-nowrap", !cat ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted hover:text-fg")}>Todos</Link>
          {categories.map((x) => (
            <Link key={x.id} href={`/catalog?c=${x.id}`} className={cn("rounded-full border px-3 py-1 text-sm whitespace-nowrap", cat?.id === x.id ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted hover:text-fg")}>{x.name}</Link>
          ))}
        </div>
      </div>
      {services.length === 0 ? <EmptyState title="No encontramos servicios" description="Prueba con otras palabras o crea un reporte general." action={<Link href="/new/issue" className="text-sm text-primary hover:underline">Reportar un problema</Link>} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <Link key={s.id} href={`/catalog/${s.id}`} className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm">
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary"><DynIcon name={s.icon} className="h-5 w-5" /></span>
                {s.category && <span className="text-[11px] text-muted">{s.category.name}</span>}
              </div>
              <p className="mt-4 font-medium">{s.name}</p>
              <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted">{s.description}</p>
              <div className="mt-4 flex items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />~{eta(s.estimatedHours)}</span>
                {s.requiresApproval && <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Requiere aprobación</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
