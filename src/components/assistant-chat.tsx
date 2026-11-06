"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, CheckCircle2, Clock, Lightbulb, Send, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, Ticket } from "lucide-react";
import { assistantAction, assistantFeedbackAction, assistantOutcomeAction } from "@/app/actions-ai";
import { createIncidentAction } from "@/app/actions";
import { DynIcon } from "./icon";
import { Button, Input, buttonClass } from "./ui";
import { useActionToast } from "./toast";
import { cn } from "@/lib/utils";

type Level = "LOW" | "MEDIUM" | "HIGH";
type Reply = {
  reply: string; mode: "ai" | "basic"; intent: string;
  articles: { id: string; slug: string; title: string; summary: string }[];
  solutions: { id: string; steps: string }[];
  service: { id: string; name: string; icon: string; estimatedHours: number; requiresApproval: boolean } | null;
  ticket: { title: string; description: string; impact: Level; urgency: Level } | null;
  tickets: { id: string; ref: string; title: string; status: string }[];
  interactionId: string | null;
};
type Msg = { role: "user" | "assistant"; content: string; extra?: Reply };

const SUGGESTIONS = ["No me funciona la VPN", "Necesito un notebook nuevo", "Olvidé mi contraseña", "¿Cómo van mis solicitudes?"];
const eta = (h: number) => (h < 24 ? `${h} h` : `${Math.round(h / 24)} día${Math.round(h / 24) > 1 ? "s" : ""}`);

/** Chat del asistente. Solo sugiere: crear un reporte requiere que la persona presione «Enviar reporte». */
export function AssistantChat({ firstName, compact = false, initial }: { firstName: string; compact?: boolean; initial?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs, pending]);

  const send = (content: string) => {
    const c = content.trim();
    if (!c || pending) return;
    const next: Msg[] = [...msgs, { role: "user", content: c }];
    setMsgs(next);
    setText("");
    start(async () => {
      const r = await assistantAction(next.slice(-20).map(({ role, content }) => ({ role, content: content.slice(0, 1000) })));
      if (r.ok && r.data) setMsgs((m) => [...m, { role: "assistant", content: r.data!.reply, extra: r.data as Reply }]);
      else if (!r.ok) { toast(r); setMsgs((m) => [...m, { role: "assistant", content: "No pude procesar tu mensaje. Inténtalo nuevamente." }]); }
      inputRef.current?.focus();
    });
  };

  const sentInitial = useRef(false);
  useEffect(() => {
    if (initial && !sentInitial.current) { sentInitial.current = true; send(initial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const lastMode = [...msgs].reverse().find((m) => m.extra)?.extra?.mode;

  return (
    <div className={cn("flex min-h-0 flex-col", compact ? "h-full" : "h-[calc(100dvh-13rem)] min-h-[28rem]")}>
      <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {msgs.length === 0 && (
          <div className="py-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300"><Sparkles className="h-6 w-6" /></div>
            <p className="mt-3 font-medium">Hola {firstName}, ¿qué necesitas?</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Escríbelo con tus palabras. Te muestro la solución, el servicio que corresponde o te dejo el reporte listo para enviar.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs hover:border-primary/50 hover:bg-subtle">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} className="flex justify-end"><p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-fg">{m.content}</p></div>
        ) : (
          <div key={i} className="flex gap-2">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300"><Sparkles className="h-3.5 w-3.5" /></span>
            <div className="min-w-0 max-w-[90%] space-y-2">
              <p className="whitespace-pre-line rounded-2xl rounded-tl-md bg-subtle px-3.5 py-2 text-sm">{m.content}</p>
              {m.extra && <Extras r={m.extra} onRetry={() => send("No me sirvió, sigue el problema")} />}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300"><Sparkles className="h-3.5 w-3.5 animate-pulse" /></span>
            Pensando…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="border-t border-border p-3">
        <div className="flex items-center gap-2">
          <Input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe lo que necesitas…" maxLength={1000} aria-label="Mensaje para el asistente" className="h-10" />
          <Button type="submit" size="md" disabled={!text.trim() || pending} aria-label="Enviar mensaje"><ArrowUp className="h-4 w-4" /></Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted">
          {lastMode === "basic" ? "Modo básico: respuestas con el catálogo y el centro de ayuda. " : lastMode === "ai" ? "Respuestas generadas por IA; revisa antes de enviar. " : ""}
          El asistente solo sugiere: nada se envía sin tu confirmación.
        </p>
      </form>
    </div>
  );
}

/** Registra lo que la persona hizo con la respuesta; el asistente aprende de eso (sin bloquear la interfaz). */
function useOutcome(id: string | null) {
  return (input: Parameters<typeof assistantOutcomeAction>[0] extends infer T ? T extends { interactionId: string } ? Omit<T, "interactionId"> : never : never) => {
    if (id) void assistantOutcomeAction({ interactionId: id, ...input } as Parameters<typeof assistantOutcomeAction>[0]).catch(() => {});
  };
}

function Extras({ r, onRetry }: { r: Reply; onRetry: () => void }) {
  const outcome = useOutcome(r.interactionId);
  const [resolved, setResolved] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const helped = (type: "ARTICLE" | "SOLUTION", id: string) => { setResolved(id); outcome({ kind: "resolved", targetType: type, targetId: id }); };
  const notHelped = (type: "ARTICLE" | "SOLUTION", id: string) => { setRejected((x) => [...x, id]); outcome({ kind: "unhelpful", targetType: type, targetId: id }); onRetry(); };
  const choice = (type: "ARTICLE" | "SOLUTION", id: string) => resolved === id ? (
    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />¡Qué bueno! Lo tendré en cuenta.</span>
  ) : resolved || rejected.includes(id) ? null : (
    <span className="flex gap-1.5">
      <button type="button" onClick={() => helped(type, id)} className="rounded-md border border-border bg-card px-2 py-1 text-xs hover:border-emerald-400 hover:text-emerald-700">Me sirvió</button>
      <button type="button" onClick={() => notHelped(type, id)} className="rounded-md border border-border bg-card px-2 py-1 text-xs hover:border-red-300 hover:text-red-700">No me sirvió</button>
    </span>
  );
  return (
    <>
      {r.solutions.map((x) => (
        <div key={x.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-200"><Lightbulb className="h-3.5 w-3.5" />Así se resolvió un caso parecido</p>
          <p className="mt-1.5 whitespace-pre-line text-sm">{x.steps}</p>
          <div className="mt-2">{choice("SOLUTION", x.id)}</div>
        </div>
      ))}
      {r.articles.map((a) => (
        <div key={a.slug} className="rounded-xl border border-border bg-card p-3">
          <Link href={`/help/${a.slug}`} target="_blank" className="flex gap-2 hover:text-primary">
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0"><span className="block text-sm font-medium">{a.title}</span><span className="line-clamp-2 text-xs text-muted">{a.summary}</span></span>
          </Link>
          <div className="mt-2 pl-6">{choice("ARTICLE", a.id)}</div>
        </div>
      ))}
      {r.service && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><DynIcon name={r.service.icon} className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{r.service.name}</span>
            <span className="flex flex-wrap gap-x-3 text-xs text-muted">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />~{eta(r.service.estimatedHours)}</span>
              {r.service.requiresApproval && <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />Requiere aprobación</span>}
            </span>
          </span>
          <Link href={`/catalog/${r.service.id}`} onClick={() => outcome({ kind: "service", targetId: r.service!.id })} className={buttonClass("primary", "sm")}>Solicitar</Link>
        </div>
      )}
      {r.tickets.map((t) => (
        <Link key={t.id} href={`/tickets/${t.id}`} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 hover:border-primary/50">
          <Ticket className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
          <span className="shrink-0 text-xs text-muted">{t.status}</span>
        </Link>
      ))}
      {r.ticket && <TicketDraft draft={r.ticket} onCreated={(id) => outcome({ kind: "ticket", ticketId: id })} />}
      {r.interactionId && (r.articles.length > 0 || r.solutions.length > 0 || r.service) && !resolved && rejected.length === 0 && <Feedback id={r.interactionId} />}
    </>
  );
}

function Feedback({ id }: { id: string }) {
  const [sent, setSent] = useState<1 | -1 | null>(null);
  const toast = useActionToast();
  const give = async (v: 1 | -1) => { setSent(v); toast(await assistantFeedbackAction(id, v)); };
  if (sent) return <p className="px-1 text-[11px] text-muted">Gracias, el asistente aprende de tu respuesta.</p>;
  return (
    <div className="flex items-center gap-1 px-1 text-[11px] text-muted">
      ¿Te sirvió esta respuesta?
      <button type="button" onClick={() => give(1)} aria-label="Sí, me sirvió" className="rounded p-1 hover:bg-subtle hover:text-emerald-600"><ThumbsUp className="h-3.5 w-3.5" /></button>
      <button type="button" onClick={() => give(-1)} aria-label="No me sirvió" className="rounded p-1 hover:bg-subtle hover:text-red-600"><ThumbsDown className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function TicketDraft({ draft, onCreated }: { draft: NonNullable<Reply["ticket"]>; onCreated: (ticketId: string) => void }) {
  const [title, setTitle] = useState(draft.title);
  const [done, setDone] = useState<{ id: string; number: number } | null>(null);
  const [pending, start] = useTransition();
  const toast = useActionToast();
  if (done) return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      <span className="flex-1">Enviado. Tu número de seguimiento es <strong>INC-{done.number}</strong>.</span>
      <Link href={`/tickets/${done.id}`} className="font-medium underline">Ver seguimiento</Link>
    </div>
  );
  return (
    <div className="rounded-xl border border-violet-200 bg-card p-3 dark:border-violet-900">
      <p className="text-xs font-medium text-muted">Reporte listo para enviar al equipo de soporte</p>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} aria-label="Título del reporte" className="mt-2" />
      <div className="mt-2 flex justify-end">
        <Button size="sm" loading={pending} disabled={title.trim().length < 5}
          onClick={() => start(async () => {
            const r = toast(await createIncidentAction({ title, description: draft.description, impact: draft.impact, urgency: draft.urgency, channel: "chat" }));
            if (r.ok && r.data) { const d = r.data as { id: string; number: number }; setDone(d); onCreated(d.id); }
          })}>
          <Send className="h-3.5 w-3.5" />Enviar reporte
        </Button>
      </div>
    </div>
  );
}
