import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Clock, Search, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { DynIcon } from "@/components/icon";
import { EmptyState, buttonClass } from "@/components/ui";
import { Carousel } from "@/components/carousel";
import { ServiceTile, coverFor, eta } from "@/components/service-tiles";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Servicios" };

const select = {
  id: true, name: true, description: true, icon: true, estimatedHours: true, requiresApproval: true, popularity: true, categoryId: true,
  category: { select: { name: true } },
} as const;

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string }> }) {
  const ctx = await requireCtx();
  const { c, q } = await searchParams;
  const categories = await db.category.findMany({ where: { orgId: ctx.orgId, services: { some: { isActive: true } } }, orderBy: { name: "asc" } });
  const cat = c === "access" ? categories.find((x) => /acceso/i.test(x.name)) : categories.find((x) => x.id === c);
  const browsing = !cat && !q;
  const order = (await db.category.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" }, select: { name: true } })).map((x) => x.name);

  const header = (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{cat ? cat.name : q ? `Resultados para «${q}»` : "¿Qué necesitas hoy?"}</h1>
        <p className="mt-1 text-sm text-muted">Elige un servicio y completa un formulario corto. Te mostramos cuánto demora y si necesita aprobación.</p>
      </div>
      <form className="relative md:w-80" role="search">
        {cat && <input type="hidden" name="c" value={cat.id} />}
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
        <input name="q" defaultValue={q} placeholder="Buscar: notebook, VPN, acceso…" aria-label="Buscar en el catálogo" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-ring" />
      </form>
    </div>
  );

  const chips = (
    <div className="scrollbar-none -mx-1 mb-8 flex gap-1.5 overflow-x-auto px-1 pb-1">
      <Link href="/catalog" className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-sm", !cat && !q ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted hover:text-fg")}>Todo</Link>
      {categories.map((x) => (
        <Link key={x.id} href={`/catalog?c=${x.id}`} className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-sm", cat?.id === x.id ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted hover:text-fg")}>{x.name}</Link>
      ))}
    </div>
  );

  if (!browsing) {
    const services = await db.serviceItem.findMany({
      where: {
        orgId: ctx.orgId, isActive: true,
        ...(cat ? { categoryId: cat.id } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { category: { name: { contains: q, mode: "insensitive" } } }] } : {}),
      },
      select,
      orderBy: [{ popularity: "desc" }, { name: "asc" }],
    });
    return (
      <div>
        {header}{chips}
        {services.length === 0 ? (
          <EmptyState title="No encontramos servicios" description="Prueba con otras palabras, pregúntale al asistente o cuéntanos qué pasa."
            action={<div className="flex gap-3 text-sm"><Link href="/assistant" className="text-primary hover:underline">Preguntar al asistente</Link><Link href="/new/issue" className="text-primary hover:underline">Reportar un problema</Link></div>} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {services.map((s) => <ServiceTile key={s.id} s={s} order={order} />)}
          </div>
        )}
      </div>
    );
  }

  // Vista de exploración: destacado + filas por categoría
  const [services, mineRaw] = await Promise.all([
    db.serviceItem.findMany({ where: { orgId: ctx.orgId, isActive: true }, select, orderBy: [{ popularity: "desc" }, { name: "asc" }] }),
    db.ticket.findMany({ where: { orgId: ctx.orgId, requesterId: ctx.user.id, serviceItemId: { not: null } }, select: { serviceItemId: true }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  if (!services.length) return <div>{header}<EmptyState title="Aún no hay servicios publicados" description="Tu equipo de TI todavía no publica el catálogo. Mientras tanto, puedes reportar un problema." action={<Link href="/new/issue" className="text-sm text-primary hover:underline">Reportar un problema</Link>} /></div>;

  const byId = new Map(services.map((s) => [s.id, s]));
  const mine = [...new Set(mineRaw.map((t) => t.serviceItemId!))].map((id) => byId.get(id)).filter((s): s is (typeof services)[number] => !!s).slice(0, 10);
  const featured = services[0]!;
  const popular = services.slice(0, 10);
  const rows = categories
    .map((cg) => ({ cg, items: services.filter((s) => s.categoryId === cg.id) }))
    .filter((r) => r.items.length > 0)
    .sort((a, b) => b.items.reduce((n, s) => n + s.popularity, 0) - a.items.reduce((n, s) => n + s.popularity, 0));

  return (
    <div>
      {header}{chips}
      <section className={cn("relative mb-10 overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-white sm:p-10", coverFor(featured.category?.name, order))}>
        <DynIcon name={featured.icon} className="pointer-events-none absolute -right-6 -top-6 h-48 w-48 opacity-15 sm:h-64 sm:w-64" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-widest text-white/80">Lo más pedido</p>
        <h2 className="mt-2 max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">{featured.name}</h2>
        <p className="mt-2 max-w-xl text-sm text-white/85">{featured.description}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/85">
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Listo en ~{eta(featured.estimatedHours)}</span>
          {featured.requiresApproval && <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Requiere aprobación</span>}
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={`/catalog/${featured.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-white/90">Solicitar ahora <ArrowRight className="h-4 w-4" /></Link>
          <Link href="/assistant" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/15 px-4 text-sm font-medium text-white backdrop-blur transition hover:bg-white/25"><Sparkles className="h-4 w-4" />No sé qué elegir</Link>
        </div>
      </section>

      <div className="space-y-9">
        {mine.length > 0 && (
          <Carousel title="Pedir de nuevo" subtitle="Servicios que ya usaste">
            {mine.map((s) => <ServiceTile key={s.id} s={s} order={order} />)}
          </Carousel>
        )}
        <Carousel title={`Popular en ${ctx.user.orgName ?? "tu empresa"}`} subtitle="Lo que más piden tus compañeros">
          {popular.map((s, i) => <ServiceTile key={s.id} s={s} order={order} badge={i < 3 ? `Top ${i + 1}` : undefined} />)}
        </Carousel>
        {rows.map(({ cg, items }) => (
          <Carousel key={cg.id} title={cg.name} seeAll={items.length > 3 ? `/catalog?c=${cg.id}` : undefined}>
            {items.map((s) => <ServiceTile key={s.id} s={s} order={order} />)}
          </Carousel>
        ))}
      </div>

      <div className="mt-12 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-8 text-center">
        <p className="font-medium">¿No encuentras lo que buscas?</p>
        <p className="max-w-md text-sm text-muted">Cuéntale al asistente qué necesitas con tus palabras, o avísanos si algo no funciona.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/assistant" className={buttonClass("primary")}><Sparkles className="h-4 w-4" />Preguntar al asistente</Link>
          <Link href="/new/issue" className={buttonClass("outline")}><Wrench className="h-4 w-4" />Algo no funciona</Link>
        </div>
      </div>
    </div>
  );
}
