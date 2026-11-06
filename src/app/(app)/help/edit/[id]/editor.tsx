"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { deleteArticleAction, saveArticleAction } from "@/app/actions";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { useActionToast } from "@/components/toast";

type A = { id: string; title: string; summary: string; body: string; categoryId: string; tags: string; isFaq: boolean; status: "DRAFT" | "PUBLISHED"; slug: string };

export function ArticleEditor({ article, categories }: { article: A | null; categories: { id: string; name: string }[] }) {
  const [f, setF] = useState({ title: article?.title ?? "", summary: article?.summary ?? "", body: article?.body ?? "1. Primer paso\n2. Segundo paso", categoryId: article?.categoryId ?? "", tags: article?.tags ?? "", isFaq: article?.isFaq ?? false, status: article?.status ?? "PUBLISHED" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const save = () => start(async () => {
    const r = toast(await saveArticleAction(article?.id ?? null, f));
    if (r.ok && r.data) router.push(`/help/${(r.data as { slug: string }).slug}`);
    else if (!r.ok) setErrors(r.fields ?? {});
  });
  const remove = () => {
    if (!article || !confirm("¿Eliminar este artículo? Esta acción no se puede deshacer.")) return;
    start(async () => { const r = toast(await deleteArticleAction(article.id)); if (r.ok) router.push("/help"); });
  };
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={article ? `/help/${article.slug}` : "/help"} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Volver</Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{article ? "Editar artículo" : "Nuevo artículo"}</h1>
      <Card className="space-y-4 p-5 sm:p-6">
        <Field label="Título" htmlFor="t" required error={errors.title}><Input id="t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ej: Cómo conectarse a la VPN" /></Field>
        <Field label="Resumen" htmlFor="s" required error={errors.summary} hint="Una frase que explique qué resuelve."><Input id="s" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
        <Field label="Contenido" htmlFor="b" required error={errors.body} hint="Escribe cada paso como «1. …», «2. …» para mostrarlo como guía paso a paso. Usa «- » para listas.">
          <Textarea id="b" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={12} className="font-mono text-[13px]" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoría" htmlFor="c"><Select id="c" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Sin categoría</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Etiquetas" htmlFor="tg" hint="Separadas por coma. Mejoran la búsqueda y las sugerencias."><Input id="tg" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="vpn, remoto" /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isFaq} onChange={(e) => setF({ ...f, isFaq: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />Mostrar en preguntas frecuentes</label>
          <label className="flex items-center gap-2 text-sm">Estado
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as A["status"] })} className="w-36"><option value="PUBLISHED">Publicado</option><option value="DRAFT">Borrador</option></Select>
          </label>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-4">
          {article ? <Button variant="ghost" className="text-red-600" onClick={remove} disabled={pending}><Trash2 className="h-4 w-4" />Eliminar</Button> : <span />}
          <Button onClick={save} loading={pending}>Guardar</Button>
        </div>
      </Card>
    </div>
  );
}
