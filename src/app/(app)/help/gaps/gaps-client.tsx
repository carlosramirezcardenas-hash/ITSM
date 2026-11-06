"use client";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePenLine, MessageSquare, Search, Sparkles, Tags, Ticket, Users, X } from "lucide-react";
import { gapAddWordsAction, gapDismissAction, gapDraftAction } from "@/app/actions-ai";
import { Badge, Button, Card, EmptyState, buttonClass } from "@/components/ui";
import { useActionToast } from "@/components/toast";
import type { Gap } from "@/server/kb-gaps";

export function GapsClient({ gaps, ai }: { gaps: Gap[]; ai: boolean }) {
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();

  if (!gaps.length) return <EmptyState icon={<Search className="h-5 w-5" />} title="No hay temas pendientes" description="Todo lo que preguntaron en los últimos 30 días tiene guía, solución o servicio. ¡Buen trabajo!" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{ai ? "«Redactar guía» usa IA con las preguntas y las soluciones reales del equipo." : "«Crear borrador» arma la guía con las preguntas y las soluciones reales del equipo (activa la IA para que la redacte)."} Siempre queda como borrador para revisar.</p>
      {gaps.map((g) => (
        <Card key={g.key} className="p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{g.label}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{g.people} persona{g.people === 1 ? "" : "s"}</span>
                {g.fromAssistant > 0 && <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{g.fromAssistant} en el asistente</span>}
                {g.fromTickets > 0 && <span className="flex items-center gap-1"><Ticket className="h-3.5 w-3.5" />{g.fromTickets} incidente{g.fromTickets === 1 ? "" : "s"}</span>}
                {g.resolutions.length > 0 && <Badge tone="green">{g.resolutions.length} solución{g.resolutions.length === 1 ? "" : "es"} aplicada{g.resolutions.length === 1 ? "" : "s"}</Badge>}
              </div>
              <ul className="mt-3 space-y-1 text-sm text-muted">
                {g.examples.map((e) => <li key={e} className="truncate">«{e}»</li>)}
              </ul>
              {g.unfound && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  Existe la guía <Link href={`/help/${g.unfound.slug}`} className="font-medium underline">«{g.unfound.title}»</Link>, pero la gente no la encontró con sus palabras ({g.topWords.join(", ")}).
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 md:flex-col md:items-stretch">
              {g.draft ? (
                <Link href={`/help/edit/${g.draft.id}`} className={buttonClass("outline", "sm")}><FilePenLine className="h-3.5 w-3.5" />Revisar borrador</Link>
              ) : g.unfound ? (
                <Button size="sm" loading={pending} onClick={() => start(async () => { const r = toast(await gapAddWordsAction(g.key, g.unfound!.id)); if (r.ok) router.refresh(); })}><Tags className="h-3.5 w-3.5" />Agregar palabras a la guía</Button>
              ) : (
                <Button size="sm" loading={pending} onClick={() => start(async () => { const r = toast(await gapDraftAction(g.key)); if (r.ok && r.data) router.push(`/help/edit/${(r.data as { id: string }).id}`); })}>
                  <Sparkles className="h-3.5 w-3.5" />{ai ? "Redactar guía" : "Crear borrador"}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = toast(await gapDismissAction(g.key)); if (r.ok) router.refresh(); })} aria-label={`Descartar ${g.label}`}><X className="h-3.5 w-3.5" />No necesita guía</Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
