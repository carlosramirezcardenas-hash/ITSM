"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import { saveServiceAction } from "@/app/actions";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { DynIcon, ICON_NAMES } from "@/components/icon";
import { useActionToast } from "@/components/toast";
import type { FormField } from "@/server/tickets";
import { PRIORITY_LABEL, ROLE_LABEL } from "@/lib/labels";
import { cn, slugify } from "@/lib/utils";

type S = {
  id?: string; name: string; description: string; icon: string; categoryId: string; estimatedHours: number; requirements: string; formSchema: FormField[];
  requiresApproval: boolean; approvalMode: "MANAGER" | "USER"; approverId: string; secondApproverId: string; ownerTeamId: string; ownerId: string; defaultPriority: string; isActive: boolean;
};
const EMPTY: S = { name: "", description: "", icon: "package", categoryId: "", estimatedHours: 24, requirements: "", formSchema: [], requiresApproval: false, approvalMode: "MANAGER", approverId: "", secondApproverId: "", ownerTeamId: "", ownerId: "", defaultPriority: "P3", isActive: true };
const TYPES: Record<FormField["type"], string> = { text: "Texto corto", textarea: "Texto largo", select: "Lista de opciones", date: "Fecha", number: "Número" };

export function ServiceEditor({ service, categories, teams, users }: { service: S | null; categories: { id: string; name: string }[]; teams: { id: string; name: string }[]; users: { id: string; name: string; role: string }[] }) {
  const [s, setS] = useState<S>(service ?? EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();

  const setField = (i: number, patch: Partial<FormField>) => setS({ ...s, formSchema: s.formSchema.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const move = (i: number, d: -1 | 1) => { const a = [...s.formSchema]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x!); setS({ ...s, formSchema: a }); };
  const addField = () => setS({ ...s, formSchema: [...s.formSchema, { key: `campo_${s.formSchema.length + 1}`, label: "", type: "text", required: false }] });

  const save = () => start(async () => {
    const payload = { ...s, formSchema: s.formSchema.map((f) => ({ ...f, key: f.key || slugify(f.label).replace(/-/g, "_") || "campo", options: f.type === "select" ? f.options ?? [] : undefined })) };
    const r = toast(await saveServiceAction(service?.id ?? null, payload));
    if (r.ok) router.push("/admin/catalog"); else setErrors(r.fields ?? {});
  });

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/catalog" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Catálogo</Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{service ? "Editar servicio" : "Nuevo servicio"}</h1>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Información general" description="Lo que verá el usuario en el catálogo." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Nombre" htmlFor="sn" required error={errors.name}><Input id="sn" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Ej: Solicitar un notebook" /></Field>
            <Field label="Categoría" htmlFor="sc"><Select id="sc" value={s.categoryId} onChange={(e) => setS({ ...s, categoryId: e.target.value })}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Descripción" htmlFor="sd" required error={errors.description} className="sm:col-span-2"><Textarea id="sd" rows={2} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></Field>
            <Field label="Requisitos (opcional)" htmlFor="sr" className="sm:col-span-2"><Input id="sr" value={s.requirements} onChange={(e) => setS({ ...s, requirements: e.target.value })} /></Field>
            <Field label="Ícono">
              <div className="flex flex-wrap gap-1.5">{ICON_NAMES.map((n) => (
                <button key={n} type="button" onClick={() => setS({ ...s, icon: n })} className={cn("rounded-lg border p-2", s.icon === n ? "border-primary bg-primary-soft text-primary" : "border-border text-muted hover:bg-subtle")} aria-label={n} aria-pressed={s.icon === n}><DynIcon name={n} className="h-4 w-4" /></button>
              ))}</div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tiempo estimado (horas)" htmlFor="sh" error={errors.estimatedHours}><Input id="sh" type="number" min={1} value={s.estimatedHours} onChange={(e) => setS({ ...s, estimatedHours: Number(e.target.value) })} /></Field>
              <Field label="Prioridad por defecto" htmlFor="sp"><Select id="sp" value={s.defaultPriority} onChange={(e) => setS({ ...s, defaultPriority: e.target.value })}>{["P1", "P2", "P3", "P4"].map((p) => <option key={p} value={p}>{p} · {PRIORITY_LABEL[p]}</option>)}</Select></Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Formulario" description="Pide solo lo indispensable: cada campo extra hace más lento el proceso." action={<Button size="sm" variant="outline" onClick={addField}><Plus className="h-4 w-4" />Campo</Button>} />
          <div className="space-y-3 p-5">
            {s.formSchema.length === 0 && <p className="text-sm text-muted">Sin campos: el usuario solo podrá dejar un comentario opcional.</p>}
            {s.formSchema.map((f, i) => (
              <div key={i} className="rounded-xl border border-border p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
                  <Input value={f.label} onChange={(e) => setField(i, { label: e.target.value, key: service && f.key && !f.key.startsWith("campo_") ? f.key : slugify(e.target.value).replace(/-/g, "_").slice(0, 40) || f.key })} placeholder="Pregunta, ej: ¿Para cuándo lo necesitas?" aria-label="Etiqueta" />
                  <Select value={f.type} onChange={(e) => setField(i, { type: e.target.value as FormField["type"] })} aria-label="Tipo">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir"><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" disabled={i === s.formSchema.length - 1} onClick={() => move(i, 1)} aria-label="Bajar"><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="text-red-600" onClick={() => setS({ ...s, formSchema: s.formSchema.filter((_, j) => j !== i) })} aria-label="Eliminar campo"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                {f.type === "select" && <Input className="mt-2" value={(f.options ?? []).join(", ")} onChange={(e) => setField(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} placeholder="Opciones separadas por coma" aria-label="Opciones" />}
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} />Obligatorio</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.sensitive} onChange={(e) => setField(i, { sensitive: e.target.checked })} /><Lock className="h-3.5 w-3.5" />Dato sensible (se guarda cifrado)</label>
                  <span className="text-xs text-muted">clave: <code>{f.key}</code></span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Atención y aprobación" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Equipo responsable" htmlFor="st"><Select id="st" value={s.ownerTeamId} onChange={(e) => setS({ ...s, ownerTeamId: e.target.value })}><option value="">—</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            <Field label="Responsable del servicio" htmlFor="so"><Select id="so" value={s.ownerId} onChange={(e) => setS({ ...s, ownerId: e.target.value })}><option value="">—</option>{users.filter((u) => ["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={s.requiresApproval} onChange={(e) => setS({ ...s, requiresApproval: e.target.checked })} />Requiere aprobación antes de atenderse</label>
            {s.requiresApproval && (
              <>
                <Field label="¿Quién aprueba?" htmlFor="am"><Select id="am" value={s.approvalMode} onChange={(e) => setS({ ...s, approvalMode: e.target.value as S["approvalMode"] })}><option value="MANAGER">Jefatura directa del solicitante</option><option value="USER">Una persona específica</option></Select></Field>
                <Field label={s.approvalMode === "USER" ? "Aprobador" : "Aprobador de respaldo"} htmlFor="ap" hint={s.approvalMode === "MANAGER" ? "Se usa si el solicitante no tiene jefatura registrada." : undefined} error={errors.approverId}>
                  <Select id="ap" value={s.approverId} onChange={(e) => setS({ ...s, approverId: e.target.value })}><option value="">—</option>{users.filter((u) => u.role !== "END_USER").map((u) => <option key={u.id} value={u.id}>{u.name} · {ROLE_LABEL[u.role]}</option>)}</Select>
                </Field>
                <Field label="Segundo nivel de aprobación (opcional)" htmlFor="ap2" hint="Se pide después de que apruebe el primer nivel. Ej: Finanzas para compras." className="sm:col-span-2">
                  <Select id="ap2" value={s.secondApproverId} onChange={(e) => setS({ ...s, secondApproverId: e.target.value })}><option value="">Sin segundo nivel</option>{users.filter((u) => u.role !== "END_USER").map((u) => <option key={u.id} value={u.id}>{u.name} · {ROLE_LABEL[u.role]}</option>)}</Select>
                </Field>
              </>
            )}
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={s.isActive} onChange={(e) => setS({ ...s, isActive: e.target.checked })} />Visible en el catálogo</label>
          </div>
        </Card>
        <div className="flex justify-end gap-2"><Link href="/admin/catalog" className="inline-flex h-9 items-center px-4 text-sm text-muted">Cancelar</Link><Button onClick={save} loading={pending}>Guardar servicio</Button></div>
      </div>
    </div>
  );
}
