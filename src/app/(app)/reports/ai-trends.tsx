"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Info, Sparkles } from "lucide-react";
import { aiTrendsAction } from "@/app/actions-ai";
import { Button, Card, CardHeader } from "@/components/ui";
import { useActionToast } from "@/components/toast";
import { cn } from "@/lib/utils";

type R = { insights: { title: string; detail: string; severity: string }[]; problem_candidates: { title: string; reason: string }[]; recommendations: string[] };

export function AiTrends({ filters, aiOn }: { filters: Record<string, string>; aiOn: boolean }) {
  const [r, setR] = useState<R | null>(null);
  const [pending, start] = useTransition();
  const toast = useActionToast();
  return (
    <Card className="border-violet-200 dark:border-violet-900">
      <CardHeader title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-500" />Análisis de tendencias con IA</span>}
        description="Interpreta los indicadores del período (solo datos agregados, sin nombres ni textos de tickets)."
        action={aiOn ? <Button size="sm" variant="outline" loading={pending} onClick={() => start(async () => { const res = toast(await aiTrendsAction(filters)); if (res.ok && res.data) setR(res.data as R); })}>{r ? "Volver a analizar" : "Analizar"}</Button> : undefined} />
      {!aiOn ? <p className="px-5 py-4 text-sm text-muted">El asistente de IA no está activo. Un administrador puede configurarlo en Integraciones.</p> : !r ? <p className="px-5 py-4 text-sm text-muted">Obtén hallazgos, posibles problemas de fondo y recomendaciones para tu equipo.</p> : (
        <div className="grid gap-6 p-5 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            {r.insights.map((i, k) => (
              <div key={k} className={cn("flex gap-2.5 rounded-lg border p-3 text-sm", i.severity === "critico" ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950" : i.severity === "atencion" ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950" : "border-border")}>
                {i.severity === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <div><p className="font-medium">{i.title}</p><p className="text-muted">{i.detail}</p></div>
              </div>
            ))}
          </div>
          <div className="space-y-4 text-sm">
            {r.problem_candidates.length > 0 && <div><p className="font-medium">Posibles problemas a investigar</p><ul className="mt-1 space-y-1.5">{r.problem_candidates.map((p, k) => <li key={k}><span className="font-medium">{p.title}</span><span className="block text-xs text-muted">{p.reason}</span></li>)}</ul><Link href="/problems/new" className="mt-2 inline-block text-xs text-primary hover:underline">Registrar un problema →</Link></div>}
            {r.recommendations.length > 0 && <div><p className="font-medium">Recomendaciones</p><ul className="mt-1 list-disc space-y-1 pl-4 text-muted">{r.recommendations.map((x, k) => <li key={k}>{x}</li>)}</ul></div>}
          </div>
        </div>
      )}
    </Card>
  );
}
