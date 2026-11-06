"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { aiApplySuggestionAction, aiSummarizeAction, aiTriageAction } from "@/app/actions-ai";
import { Badge, Button, Card } from "@/components/ui";
import { useActionToast } from "@/components/toast";
import { LEVEL_LABEL, PRIORITY_LABEL } from "@/lib/labels";

type Suggestion = { categoryId: string | null; categoryName: string | null; impact: string; urgency: string; priority: string; confidence: number; rationale: string; articles: { id: string; slug: string; title: string }[]; applied: boolean; at: string };
type Summary = { summary: string; key_points: string[]; next_step: string; sentiment: string };

export function AiPanel({ ticketId, aiOn, isIncident, closed, suggestion, summary, summaryAt, current }: {
  ticketId: string; aiOn: boolean; isIncident: boolean; closed: boolean; suggestion: Suggestion | null; summary: Summary | null; summaryAt: string | null;
  current: { impact: string; urgency: string; categoryId: string | null; priority: string };
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useActionToast();
  const router = useRouter();
  const go = (key: string, fn: () => Promise<any>) => { setBusy(key); start(async () => { const r = toast(await fn()); setBusy(null); if (r.ok) router.refresh(); }); };

  if (!aiOn) return (
    <Card className="p-4 text-xs text-muted">
      <p className="flex items-center gap-1.5 font-medium text-fg"><Sparkles className="h-3.5 w-3.5" />Asistente de IA</p>
      <p className="mt-1">No está activo en esta organización. Un administrador puede configurarlo en Integraciones.</p>
    </Card>
  );
  const differs = suggestion && (suggestion.impact !== current.impact || suggestion.urgency !== current.urgency || (suggestion.categoryId && suggestion.categoryId !== current.categoryId));
  return (
    <Card className="border-violet-200 dark:border-violet-900">
      <div className="border-b border-border px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-4 w-4 text-violet-500" />Asistente de IA</p>
        <p className="text-[11px] text-muted">Son sugerencias: revísalas antes de aplicarlas.</p>
      </div>
      <div className="space-y-4 p-4 text-sm">
        {isIncident && (
          suggestion ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Clasificación sugerida</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {suggestion.categoryName && <Badge tone="violet">{suggestion.categoryName}</Badge>}
                <Badge tone="violet">{suggestion.priority} · {PRIORITY_LABEL[suggestion.priority]}</Badge>
                <Badge>Confianza {Math.round(suggestion.confidence * 100)}%</Badge>
              </div>
              <p className="mt-1.5 text-xs text-muted">Impacto {LEVEL_LABEL[suggestion.impact]?.toLowerCase()}, urgencia {LEVEL_LABEL[suggestion.urgency]?.toLowerCase()}. {suggestion.rationale}</p>
              {suggestion.applied && <p className="mt-1 text-xs text-muted">La categoría se aplicó automáticamente (alta confianza y sin categoría previa).</p>}
              {suggestion.articles.length > 0 && <ul className="mt-2 space-y-1">{suggestion.articles.map((a) => <li key={a.id}><Link href={`/help/${a.slug}`} target="_blank" className="flex items-center gap-1.5 text-xs text-primary hover:underline"><BookOpen className="h-3 w-3" />{a.title}</Link></li>)}</ul>}
              {!closed && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {differs && <Button size="sm" loading={busy === "apply"} disabled={pending} onClick={() => go("apply", () => aiApplySuggestionAction(ticketId))}><Wand2 className="h-3.5 w-3.5" />Aplicar sugerencia</Button>}
                  <Button size="sm" variant="ghost" loading={busy === "triage"} disabled={pending} onClick={() => go("triage", () => aiTriageAction(ticketId))}><RefreshCw className="h-3.5 w-3.5" />Volver a analizar</Button>
                </div>
              )}
            </div>
          ) : !closed && (
            <Button size="sm" variant="outline" loading={busy === "triage"} disabled={pending} onClick={() => go("triage", () => aiTriageAction(ticketId))}><Wand2 className="h-3.5 w-3.5" />Sugerir clasificación</Button>
          )
        )}
        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Resumen</p>
            <button disabled={pending} onClick={() => go("sum", () => aiSummarizeAction(ticketId))} className="text-xs text-primary hover:underline disabled:opacity-50">{busy === "sum" ? "Resumiendo…" : summary ? "Actualizar" : "Resumir con IA"}</button>
          </div>
          {summary ? (
            <div className="mt-1.5 space-y-2">
              <p>{summary.summary}</p>
              {summary.key_points.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">{summary.key_points.map((k, i) => <li key={i}>{k}</li>)}</ul>}
              <p className="text-xs"><span className="font-medium">Siguiente paso:</span> {summary.next_step}</p>
              <p className="text-[11px] text-muted">Ánimo del solicitante: {summary.sentiment}{summaryAt ? ` · ${summaryAt}` : ""}</p>
            </div>
          ) : <p className="mt-1 text-xs text-muted">Útil para tickets largos o al tomar un caso de otra persona.</p>}
        </div>
      </div>
    </Card>
  );
}
