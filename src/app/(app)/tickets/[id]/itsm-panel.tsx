"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Bug, Lightbulb, Network, X } from "lucide-react";
import { linkArticleAction } from "@/app/actions-itsm";
import { updateTicketAction } from "@/app/actions";
import { Card, CardHeader, Select } from "@/components/ui";
import { useActionToast } from "@/components/toast";
import { CI_TYPE_LABEL } from "@/lib/labels";

type Props = {
  ticketId: string; closed: boolean; isIncident: boolean;
  configItem: { id: string; name: string; type: string } | null;
  problem: { id: string; number: number; title: string; status: string } | null;
  articles: { id: string; slug: string; title: string }[];
  knownErrors: { id: string; number: number; title: string; workaround: string | null }[];
  cis: { id: string; name: string; type: string }[];
  problems: { id: string; number: number; title: string }[];
  allArticles: { id: string; title: string }[];
};

export function ItsmPanel(p: Props) {
  const [pending, start] = useTransition();
  const [addArticle, setAddArticle] = useState("");
  const toast = useActionToast();
  const router = useRouter();
  const go = (fn: () => Promise<any>, after?: () => void) => start(async () => { const r = toast(await fn()); if (r.ok) { after?.(); router.refresh(); } });
  return (
    <>
      {p.knownErrors.length > 0 && !p.problem && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader title={<span className="flex items-center gap-1.5"><Lightbulb className="h-4 w-4 text-amber-500" />Errores conocidos relacionados</span>} description="Aplica la solución temporal y vincula el incidente." />
          <ul className="divide-y divide-border">
            {p.knownErrors.map((k) => (
              <li key={k.id} className="space-y-1.5 px-4 py-3 text-sm">
                <Link href={`/problems/${k.id}`} className="font-medium hover:underline">PRB-{k.number} · {k.title}</Link>
                {k.workaround && <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted">{k.workaround}</p>}
                {!p.closed && <button disabled={pending} onClick={() => go(() => updateTicketAction(p.ticketId, { problemId: k.id }))} className="text-xs font-medium text-primary hover:underline">Vincular a este problema</button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="space-y-4 p-4 text-sm">
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted"><Network className="h-3.5 w-3.5" />Elemento afectado (CMDB)</p>
          {p.configItem && <Link href={`/cmdb/${p.configItem.id}`} className="mb-1.5 block text-primary hover:underline">{p.configItem.name} · {CI_TYPE_LABEL[p.configItem.type]}</Link>}
          {!p.closed && (
            <Select value={p.configItem?.id ?? ""} disabled={pending} onChange={(e) => go(() => updateTicketAction(p.ticketId, { configItemId: e.target.value || null }))} aria-label="Elemento afectado">
              <option value="">Sin elemento</option>{p.cis.map((c) => <option key={c.id} value={c.id}>{c.name} · {CI_TYPE_LABEL[c.type]}</option>)}
            </Select>
          )}
        </div>
        {p.isIncident && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted"><Bug className="h-3.5 w-3.5" />Problema</p>
            {p.problem ? (
              <div className="flex items-start gap-2">
                <Link href={`/problems/${p.problem.id}`} className="flex-1 text-primary hover:underline">PRB-{p.problem.number} · {p.problem.title}</Link>
                {!p.closed && <button disabled={pending} onClick={() => go(() => updateTicketAction(p.ticketId, { problemId: null }))} aria-label="Desvincular problema" className="text-muted hover:text-red-600"><X className="h-4 w-4" /></button>}
              </div>
            ) : !p.closed && (
              <div className="space-y-1.5">
                <Select value="" disabled={pending} onChange={(e) => e.target.value && go(() => updateTicketAction(p.ticketId, { problemId: e.target.value }))} aria-label="Vincular a problema">
                  <option value="">Vincular a un problema…</option>{p.problems.map((x) => <option key={x.id} value={x.id}>PRB-{x.number} · {x.title}</option>)}
                </Select>
                <Link href={`/problems/new?from=${p.ticketId}`} className="block text-xs font-medium text-primary hover:underline">+ Crear problema desde este incidente</Link>
              </div>
            )}
          </div>
        )}
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted"><BookOpen className="h-3.5 w-3.5" />Artículos usados</p>
          <ul className="mb-1.5 space-y-1">
            {p.articles.map((a) => (
              <li key={a.id} className="flex items-start gap-2"><Link href={`/help/${a.slug}`} className="flex-1 text-primary hover:underline">{a.title}</Link>
                <button disabled={pending} onClick={() => go(() => linkArticleAction(p.ticketId, a.id, false))} className="text-muted hover:text-red-600" aria-label={`Desvincular ${a.title}`}><X className="h-4 w-4" /></button></li>
            ))}
          </ul>
          <Select value={addArticle} disabled={pending} onChange={(e) => { setAddArticle(e.target.value); if (e.target.value) go(() => linkArticleAction(p.ticketId, e.target.value, true), () => setAddArticle("")); }} aria-label="Vincular artículo">
            <option value="">Vincular artículo…</option>{p.allArticles.filter((a) => !p.articles.some((x) => x.id === a.id)).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </Select>
        </div>
      </Card>
    </>
  );
}
