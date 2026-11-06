"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock, Lock, ShieldCheck, Users } from "lucide-react";
import { createRequestAction } from "@/app/actions";
import { Button, Card, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { DynIcon } from "@/components/icon";
import { useActionToast } from "@/components/toast";
import type { FormField } from "@/server/tickets";

type Service = { id: string; name: string; description: string; icon: string; estimatedHours: number; requirements: string | null; requiresApproval: boolean; category: string | null; team: string | null; owner: string | null; fields: FormField[] };
const eta = (h: number) => (h < 24 ? `${h} horas` : `${Math.round(h / 24)} días`);

export function RequestForm({ service, approverName, staff, users, me }: { service: Service; approverName: string | null; staff: boolean; users: { id: string; name: string }[]; me: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [requesterId, setRequesterId] = useState(me);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ id: string; number: number; approval: boolean } | null>(null);
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();

  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const missing: Record<string, string> = {};
    for (const f of service.fields) if (f.required && !answers[f.key]?.trim()) missing[`answers.${f.key}`] = "Este campo es obligatorio.";
    setErrors(missing);
    if (Object.keys(missing).length) return;
    start(async () => {
      const r = toast(await createRequestAction({ serviceItemId: service.id, answers, note, requesterId: staff ? requesterId : undefined }));
      if (r.ok && r.data) { setDone(r.data as { id: string; number: number; approval: boolean }); router.refresh(); }
      else if (!r.ok) setErrors(r.fields ?? {});
    });
  };

  if (done) return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950"><CheckCircle2 className="h-7 w-7" /></div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">¡Solicitud enviada!</h1>
      <p className="mt-2 text-muted">Número de seguimiento <strong className="text-fg">REQ-{done.number}</strong>.{" "}
        {done.approval ? <>Primero debe aprobarla <strong className="text-fg">{approverName}</strong>; te avisaremos apenas responda.</> : <>El equipo de {service.team ?? "soporte"} ya la recibió.</>}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href={`/tickets/${done.id}`} className={buttonClass("primary")}>Ver seguimiento</Link>
        <Link href="/catalog" className={buttonClass("outline")}>Pedir otra cosa</Link>
      </div>
    </div>
  );

  const renderField = (f: FormField) => {
    const id = `f-${f.key}`;
    const err = errors[`answers.${f.key}`];
    const common = { id, value: answers[f.key] ?? "", "aria-invalid": !!err, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(f.key, e.target.value) };
    return (
      <Field key={f.key} label={f.label} htmlFor={id} required={f.required} error={err} hint={f.sensitive ? "Dato protegido: se guarda cifrado." : undefined}>
        {f.type === "select" ? (
          <Select {...common}><option value="">Selecciona…</option>{f.options?.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
        ) : f.type === "textarea" ? <Textarea {...common} rows={3} placeholder={f.placeholder} />
          : <div className="relative"><Input {...common} type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} placeholder={f.placeholder} className={f.sensitive ? "pr-8" : undefined} />{f.sensitive && <Lock className="absolute right-2.5 top-2.5 h-4 w-4 text-muted" />}</div>}
      </Field>
    );
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/catalog" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Catálogo</Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card className="p-5 sm:p-6">
          <div className="mb-6 flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><DynIcon name={service.icon} className="h-6 w-6" /></span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{service.name}</h1>
              <p className="mt-1 text-sm text-muted">{service.description}</p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-5" noValidate>
            {staff && (
              <Field label="Solicitante" htmlFor="req" hint="Estás registrando esta solicitud en nombre de otra persona.">
                <Select id="req" value={requesterId} onChange={(e) => setRequesterId(e.target.value)}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
              </Field>
            )}
            {service.fields.map(renderField)}
            <Field label="Comentario adicional (opcional)" htmlFor="note"><Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
            <div className="flex justify-end gap-2 border-t border-border pt-5">
              <Link href="/catalog" className={buttonClass("ghost")}>Cancelar</Link>
              <Button type="submit" size="lg" loading={pending}>Enviar solicitud</Button>
            </div>
          </form>
        </Card>
        <aside className="space-y-3 text-sm">
          <Card className="space-y-3 p-4">
            <p className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted" />Tiempo estimado: <strong>{eta(service.estimatedHours)}</strong></p>
            {service.requiresApproval ? <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 text-amber-500" /><span>Requiere aprobación de <strong>{approverName}</strong>.</span></p>
              : <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-500" />No requiere aprobación</p>}
            {service.team && <p className="flex items-center gap-2"><Users className="h-4 w-4 text-muted" />Lo atiende: {service.team}{service.owner ? ` (${service.owner})` : ""}</p>}
          </Card>
          {service.requirements && <Card className="p-4"><p className="font-medium">Antes de pedirlo</p><p className="mt-1 text-muted">{service.requirements}</p></Card>}
        </aside>
      </div>
    </div>
  );
}
