"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUp, BookOpen, CheckCircle2, Clock, Send, ShieldCheck, Sparkles, Ticket } from "lucide-react";
import { assistantAction } from "@/app/actions-ai";
import { createIncidentAction } from "@/app/actions";
import { DynIcon } from "./icon";
import { Button, Input, buttonClass } from "./ui";
import { useActionToast } from "./toast";
import { cn } from "@/lib/utils";

type Level = "LOW" | "MEDIUM" | "HIGH";
type Reply = {
  reply: string; mode: "ai" | "basic"; intent: string;
  articles: { slug: string; title: string; summary: string }[];
  service: { id: string; name: string; icon: string; estimatedHours: number; requiresApproval: boolean } | null;
  ticket: { title: string; description: string; impact: Level; urgency: Level } | null;
  tickets: { id: string; ref: string; title: string; status: string }[];
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
              {m.extra && <Extras r={m.extra} />}
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

function Extras({ r }: { r: Reply }) {
  return (
    <>
      {r.articles.map((a) => (
        <Link key={a.slug} href={`/help/${a.slug}`} target="_blank" className="flex gap-2 rounded-xl border border-border bg-card p-3 hover:border-primary/50">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0"><span className="block text-sm font-medium">{a.title}</span><span className="line-clamp-2 text-xs text-muted">{a.summary}</span></span>
        </Link>
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
          <Link href={`/catalog/${r.service.id}`} className={buttonClass("primary", "sm")}>Solicitar</Link>
        </div>
      )}
      {r.tickets.map((t) => (
        <Link key={t.id} href={`/tickets/${t.id}`} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 hover:border-primary/50">
          <Ticket className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
          <span className="shrink-0 text-xs text-muted">{t.status}</span>
        </Link>
      ))}
      {r.ticket && <TicketDraft draft={r.ticket} />}
    </>
  );
}

function TicketDraft({ draft }: { draft: NonNullable<Reply["ticket"]> }) {
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
            if (r.ok && r.data) setDone(r.data as { id: string; number: number });
          })}>
          <Send className="h-3.5 w-3.5" />Enviar reporte
        </Button>
      </div>
    </div>
  );
}
