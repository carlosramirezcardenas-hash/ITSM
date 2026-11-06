import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Eye, PenSquare } from "lucide-react";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requireCtx } from "@/server/auth";
import { Badge, Card, buttonClass } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { ArticleFeedback } from "./feedback";

export const metadata: Metadata = { title: "Artículo" };
export const dynamic = "force-dynamic";

function renderBody(body: string) {
  const blocks: React.ReactNode[] = [];
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line) { i++; continue; }
    if (/^\d+\.\s/.test(line)) {
      const steps: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!.trim())) steps.push(lines[i++]!.trim().replace(/^\d+\.\s/, ""));
      blocks.push(
        <ol key={i} className="my-4 space-y-3">
          {steps.map((s, n) => (
            <li key={n} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{n + 1}</span><span className="pt-0.5">{linkify(s)}</span></li>
          ))}
        </ol>,
      );
    } else if (/^-\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s/.test(lines[i]!.trim())) items.push(lines[i++]!.trim().slice(2));
      blocks.push(<ul key={i} className="my-3 list-disc space-y-1 pl-5">{items.map((s, n) => <li key={n}>{linkify(s)}</li>)}</ul>);
    } else { blocks.push(<p key={i} className="my-3">{linkify(line)}</p>); i++; }
  }
  return blocks;
}
function linkify(s: string) {
  return s.split(/(https:\/\/[^\s]+)/g).map((part, i) => part.startsWith("https://") ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-primary underline">{part}</a> : part);
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireCtx();
  const { slug } = await params;
  const manage = can(ctx.user.role, "kb:manage");
  const a = await db.kbArticle.findFirst({ where: { orgId: ctx.orgId, slug, ...(manage ? {} : { status: "PUBLISHED" }) }, include: { category: true, author: { select: { name: true } } } });
  if (!a) notFound();
  await db.kbArticle.update({ where: { id: a.id }, data: { views: { increment: 1 } } });
  const mine = await db.kbFeedback.findUnique({ where: { articleId_userId: { articleId: a.id, userId: ctx.user.id } } });
  const related = await db.kbArticle.findMany({ where: { orgId: ctx.orgId, status: "PUBLISHED", id: { not: a.id }, OR: [{ categoryId: a.categoryId }, { tags: { hasSome: a.tags } }] }, select: { slug: true, title: true }, take: 4 });
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/help" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Centro de ayuda</Link>
        {manage && <Link href={`/help/edit/${a.id}`} className={buttonClass("outline", "sm")}><PenSquare className="h-4 w-4" />Editar</Link>}
      </div>
      <article>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {a.category?.name}{a.isFaq && <Badge tone="primary">FAQ</Badge>}{a.status === "DRAFT" && <Badge tone="amber">Borrador</Badge>}
          <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{a.views + 1} lecturas</span>· actualizado {timeAgo(a.updatedAt)}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{a.title}</h1>
        <p className="mt-2 text-muted">{a.summary}</p>
        <Card className="mt-6 px-5 py-3 text-[15px] leading-relaxed sm:px-7">{renderBody(a.body)}</Card>
        {a.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{a.tags.map((t) => <Link key={t} href={`/help?q=${encodeURIComponent(t)}`}><Badge>#{t}</Badge></Link>)}</div>}
      </article>
      <ArticleFeedback articleId={a.id} initial={mine?.helpful ?? null} />
      {related.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Artículos relacionados</h2>
          <ul className="space-y-1">{related.map((r) => <li key={r.slug}><Link href={`/help/${r.slug}`} className="text-sm text-primary hover:underline">{r.title}</Link></li>)}</ul>
        </section>
      )}
    </div>
  );
}
