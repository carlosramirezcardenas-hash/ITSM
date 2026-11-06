import Link from "next/link";
import type { Metadata } from "next";
import { BookOpen, ChevronDown, Eye, PenSquare, Search, ThumbsUp, SearchX } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requireCtx } from "@/server/auth";
import { tokens } from "@/lib/classify";
import { Badge, Card, EmptyState, buttonClass } from "@/components/ui";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Centro de ayuda" };
export const dynamic = "force-dynamic";

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string; c?: string }> }) {
  const ctx = await requireCtx();
  const { q, c } = await searchParams;
  const manage = can(ctx.user.role, "kb:manage");
  const base: Prisma.KbArticleWhereInput = { orgId: ctx.orgId, ...(manage ? {} : { status: "PUBLISHED" }) };
  // Búsqueda: título/resumen/cuerpo + coincidencia de etiquetas por palabra
  const words = q ? [...tokens(q)] : [];
  const where: Prisma.KbArticleWhereInput = {
    ...base,
    ...(c ? { categoryId: c } : {}),
    ...(q ? { OR: [
      { title: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } },
      ...(words.length ? [{ tags: { hasSome: words } }] : []),
      ...words.map((w) => ({ title: { contains: w, mode: "insensitive" as const } })),
    ] } : {}),
  };
  const [articles, faqs, categories] = await Promise.all([
    db.kbArticle.findMany({ where: { ...where, ...(q || c ? {} : { isFaq: false }) }, include: { category: true }, orderBy: [{ views: "desc" }], take: 30 }),
    q || c ? Promise.resolve([]) : db.kbArticle.findMany({ where: { ...base, isFaq: true, status: "PUBLISHED" }, orderBy: { views: "desc" } }),
    db.category.findMany({ where: { orgId: ctx.orgId, articles: { some: base } }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Centro de ayuda</h1>
        <p className="mt-1 text-sm text-muted">Guías paso a paso para resolverlo tú mismo, en minutos.</p>
        <form className="mx-auto mt-5 flex max-w-xl items-center gap-2 rounded-xl border border-border bg-card p-1.5 shadow-sm">
          <Search className="ml-2 h-4 w-4 text-muted" />
          <input name="q" defaultValue={q} placeholder="¿Qué necesitas resolver?" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Buscar artículos" />
          <button className={buttonClass("primary", "sm")}>Buscar</button>
        </form>
        {manage && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/help/edit/new" className={buttonClass("outline", "sm")}><PenSquare className="h-4 w-4" />Nuevo artículo</Link>
            <Link href="/help/gaps" className={buttonClass("outline", "sm")}><SearchX className="h-4 w-4" />Lo que falta</Link>
          </div>
        )}
      </div>
      <div className="scrollbar-thin mb-6 flex gap-1.5 overflow-x-auto pb-1">
        <Link href="/help" className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-sm", !c ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted")}>Todo</Link>
        {categories.map((x) => <Link key={x.id} href={`/help?c=${x.id}`} className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-sm", c === x.id ? "border-primary bg-primary-soft text-primary" : "border-border bg-card text-muted")}>{x.name}</Link>)}
      </div>

      {q && <p className="mb-3 text-sm text-muted">{articles.length} resultado(s) para «{q}»</p>}
      {articles.length === 0 ? (
        <Card><EmptyState icon={<BookOpen className="h-5 w-5" />} title="No encontramos un artículo para eso" description="No te preocupes: crea una solicitud y el equipo de soporte te ayudará." action={<Link href="/new" className={buttonClass()}>Crear solicitud</Link>} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {articles.map((a) => (
            <Link key={a.id} href={`/help/${a.slug}`} className="rounded-xl border border-border bg-card p-4 transition hover:border-primary/50">
              <div className="flex items-center gap-2 text-[11px] text-muted">
                {a.category?.name}{a.isFaq && <Badge tone="primary">FAQ</Badge>}{a.status === "DRAFT" && <Badge tone="amber">Borrador</Badge>}
              </div>
              <p className="mt-1 font-medium">{a.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{a.summary}</p>
              <p className="mt-3 flex gap-3 text-xs text-muted"><span className="flex items-center gap-1"><Eye className="h-3 w-3" />{a.views}</span><span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{a.helpfulYes + a.helpfulNo ? Math.round((a.helpfulYes / (a.helpfulYes + a.helpfulNo)) * 100) : 0}% útil</span></p>
            </Link>
          ))}
        </div>
      )}

      {faqs.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Preguntas frecuentes</h2>
          <Card className="divide-y divide-border">
            {faqs.map((f) => (
              <details key={f.id} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">{f.title}<ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" /></summary>
                <p className="mt-2 whitespace-pre-line text-sm text-muted">{f.body}</p>
                <Link href={`/help/${f.slug}`} className="mt-2 inline-block text-xs text-primary hover:underline">Ver artículo completo</Link>
              </details>
            ))}
          </Card>
        </section>
      )}
      <p className="mt-10 text-center text-sm text-muted">¿No encontraste lo que buscabas? <Link href="/new" className="text-primary hover:underline">Pide ayuda al equipo de soporte</Link></p>
    </div>
  );
}
