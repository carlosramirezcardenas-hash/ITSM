import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { ArticleEditor } from "./editor";

export const metadata: Metadata = { title: "Editar artículo" };

export default async function EditArticle({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx("kb:manage");
  const { id } = await params;
  const a = id === "new" ? null : await db.kbArticle.findFirst({ where: { id, orgId: ctx.orgId } });
  if (id !== "new" && !a) notFound();
  const categories = await db.category.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <ArticleEditor categories={categories} article={a ? { id: a.id, title: a.title, summary: a.summary, body: a.body, categoryId: a.categoryId ?? "", tags: a.tags.join(", "), isFaq: a.isFaq, status: a.status, slug: a.slug } : null} />;
}
