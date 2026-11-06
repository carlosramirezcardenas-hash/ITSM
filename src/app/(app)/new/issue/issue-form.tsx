"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, CheckCircle2, Sparkles } from "lucide-react";
import { createIncidentAction, suggestAction } from "@/app/actions";
import { aiSelfHelpAction } from "@/app/actions-ai";
import { Button, Card, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { useActionToast } from "@/components/toast";
import { IMPACT_USER_LABEL, URGENCY_USER_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Level = "LOW" | "MEDIUM" | "HIGH";
type Suggest = { category: { id: string; name: string } | null; impact: Level | null; urgency: Level | null; articles: { id: string; title: string; slug: string; summary: string }[] };

function Choice({ value, onChange, labels, name }: { value: Level; onChange: (v: Level) => void; labels: Record<string, string>; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2 sm:grid-cols-3">
      {(["LOW", "MEDIUM", "HIGH"] as Level[]).map((l) => (
        <button type="button" role="radio" aria-checked={value === l} key={l} onClick={() => onChange(l)}
          className={cn("rounded-lg border px-3 py-2.5 text-left text-sm transition", value === l ? "border-primary bg-primary-soft font-medium text-fg ring-1 ring-primary" : "border-border bg-card hover:bg-subtle")}>
          {labels[l]}
        </button>
      ))}
    </div>
  );
}

type Help = { answer: string; articles: { slug: string; title: string }[]; resolvedLikely: boolean };

export function IssueForm({ staff, users, categories, me, aiOn = false }: { staff: boolean; users: { id: string; name: string; email: string }[]; categories: { id: string; name: string }[]; me: string; aiOn?: boolean }) {
  const [help, setHelp] = useState<Help | null>(null);
  const [asking, startAsk] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState<Level>("LOW");
  const [urgency, setUrgency] = useState<Level>("MEDIUM");
  const [requesterId, setRequesterId] = useState(me);
  const [categoryId, setCategoryId] = useState("");
  const [channel, setChannel] = useState("portal");
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ id: string; number: number } | null>(null);
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();

  useEffect(() => {
    const text = `${title} ${description}`.trim();
    if (text.length < 6) { setSuggest(null); return; }
    const t = setTimeout(async () => {
      const r = await suggestAction(text);
      if (r.ok && r.data) {
        setSuggest(r.data);
        if (r.data.impact === "HIGH") setImpact((i) => (i === "LOW" ? "HIGH" : i));
        if (r.data.urgency === "HIGH") setUrgency((u) => (u !== "HIGH" ? "HIGH" : u));
      }
    }, 450);
    return () => clearTimeout(t);
  }, [title, description]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    start(async () => {
      const r = toast(await createIncidentAction({ title, description, impact, urgency, requesterId: staff ? requesterId : undefined, categoryId: staff && categoryId ? categoryId : undefined, channel: staff ? channel : "portal" }));
      if (r.ok && r.data) { setDone(r.data as { id: string; number: number }); router.refresh(); }
      else if (!r.ok) setErrors(r.fields ?? {});
    });
  };

  if (done) return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950"><CheckCircle2 className="h-7 w-7" /></div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">¡Recibimos tu reporte!</h1>
      <p className="mt-2 text-muted">Tu número de seguimiento es <strong className="text-fg">INC-{done.number}</strong>. Te avisaremos cada vez que haya novedades.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href={`/tickets/${done.id}`} className={buttonClass("primary")}>Ver seguimiento</Link>
        <Link href="/home" className={buttonClass("outline")}>Volver al inicio</Link>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/new" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Volver</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{staff ? "Registrar incidente" : "Cuéntanos qué pasa"}</h1>
      <p className="mt-1 text-sm text-muted">Solo necesitamos una frase. Nosotros nos encargamos del resto.</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-5 sm:p-6">
          <form onSubmit={submit} className="space-y-5" noValidate>
            {staff && (
              <div className="grid gap-4 rounded-xl bg-subtle p-4 sm:grid-cols-3">
                <Field label="Solicitante" htmlFor="req">
                  <Select id="req" value={requesterId} onChange={(e) => setRequesterId(e.target.value)}>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </Field>
                <Field label="Categoría" htmlFor="cat" hint="Vacío = automática">
                  <Select id="cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">Automática</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Canal" htmlFor="ch">
                  <Select id="ch" value={channel} onChange={(e) => setChannel(e.target.value)}>
                    <option value="portal">Portal</option><option value="phone">Teléfono</option><option value="email">Correo</option><option value="chat">Chat</option><option value="walk-in">Presencial</option>
                  </Select>
                </Field>
              </div>
            )}
            <Field label="¿Qué está pasando?" htmlFor="title" required error={errors.title}>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: No puedo conectarme a la VPN desde mi casa" maxLength={160} autoFocus aria-invalid={!!errors.title} className="h-11 text-[15px]" />
            </Field>
            <Field label="Cuéntanos más (opcional)" htmlFor="desc" hint="¿Desde cuándo? ¿Aparece algún mensaje de error?">
              <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
            </Field>
            <Field label="¿A quién afecta?">
              <Choice name="Impacto" value={impact} onChange={setImpact} labels={IMPACT_USER_LABEL} />
            </Field>
            <Field label="¿Cuánto te afecta?">
              <Choice name="Urgencia" value={urgency} onChange={setUrgency} labels={URGENCY_USER_LABEL} />
            </Field>
            <div className="flex items-center justify-end gap-2 border-t border-border pt-5">
              <Link href="/home" className={buttonClass("ghost")}>Cancelar</Link>
              <Button type="submit" size="lg" loading={pending} disabled={title.trim().length < 5}>Enviar reporte</Button>
            </div>
          </form>
        </Card>
        <aside className="space-y-4">
          {aiOn && !staff && (
            <Card className="border-violet-200 p-4 dark:border-violet-900">
              <p className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-4 w-4 text-violet-500" />¿Lo intentamos resolver ahora?</p>
              {!help ? (
                <>
                  <p className="mt-0.5 text-xs text-muted">El asistente busca la solución en las guías de tu empresa.</p>
                  <Button size="sm" variant="outline" className="mt-3" loading={asking} disabled={`${title} ${description}`.trim().length < 6}
                    onClick={() => startAsk(async () => { const r = toast(await aiSelfHelpAction(`${title}\n${description}`)); if (r.ok && r.data) setHelp(r.data as Help); })}>Pedir ayuda a la IA</Button>
                </>
              ) : (
                <div className="mt-2 space-y-2 text-sm">
                  {help.answer ? <p className="whitespace-pre-line">{help.answer}</p> : <p className="text-muted">No encontramos una guía para esto. Envía tu reporte y el equipo te ayudará.</p>}
                  {help.articles.map((a) => <Link key={a.slug} href={`/help/${a.slug}`} target="_blank" className="flex items-center gap-1.5 text-xs text-primary hover:underline"><BookOpen className="h-3 w-3" />{a.title}</Link>)}
                  <p className="text-[11px] text-muted">Respuesta generada por IA a partir del centro de ayuda. Si no se resolvió, envía tu reporte.</p>
                  {help.resolvedLikely && <Link href="/home" className={buttonClass("outline", "sm")}>Se resolvió, no necesito ayuda</Link>}
                </div>
              )}
            </Card>
          )}
          {suggest?.articles.length ? (
            <Card className="animate-in border-primary/30 p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="h-4 w-4 text-primary" />¿Esto te ayuda?</p>
              <p className="mt-0.5 text-xs text-muted">Puede que lo resuelvas ahora mismo.</p>
              <ul className="mt-3 space-y-2">
                {suggest.articles.map((a) => (
                  <li key={a.id}>
                    <Link href={`/help/${a.slug}`} target="_blank" className="flex gap-2 rounded-lg p-2 hover:bg-subtle">
                      <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span><span className="block text-sm font-medium">{a.title}</span><span className="line-clamp-2 text-xs text-muted">{a.summary}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card className="p-4 text-sm text-muted">
              <p className="font-medium text-fg">Consejo</p>
              <p className="mt-1">Mientras escribes, te sugeriremos guías que podrían resolverlo al instante.</p>
            </Card>
          )}
          {suggest?.category && (
            <p className="px-1 text-xs text-muted">Lo enviaremos al equipo de <strong className="text-fg">{suggest.category.name}</strong> (clasificación automática).</p>
          )}
        </aside>
      </div>
    </div>
  );
}
