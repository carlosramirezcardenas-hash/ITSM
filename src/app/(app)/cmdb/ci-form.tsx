"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { deleteCIAction, saveCIAction } from "@/app/actions-itsm";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { useActionToast } from "@/components/toast";
import { CI_STATUS_LABEL, CI_TYPE_LABEL, LEVEL_LABEL } from "@/lib/labels";

export type CIForm = { name: string; type: string; status: string; criticality: string; description: string; ownerId: string; teamId: string; serial: string; location: string; ipAddress: string; version: string; seats: string; seatsUsed: string; expiresAt: string; contact: string };
export const EMPTY_CI: CIForm = { name: "", type: "SERVER", status: "ACTIVE", criticality: "MEDIUM", description: "", ownerId: "", teamId: "", serial: "", location: "", ipAddress: "", version: "", seats: "", seatsUsed: "", expiresAt: "", contact: "" };

export function CiForm({ id, initial, staff, teams }: { id?: string; initial: Partial<CIForm>; staff: { id: string; name: string }[]; teams: { id: string; name: string }[] }) {
  const [f, setF] = useState<CIForm>({ ...EMPTY_CI, ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const set = (k: keyof CIForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = () => start(async () => {
    const r = toast<unknown>(await saveCIAction(id ?? null, { ...f, seats: f.seats === "" ? null : Number(f.seats), seatsUsed: f.seatsUsed === "" ? null : Number(f.seatsUsed) }));
    if (r.ok) router.push(`/cmdb/${id ?? (r.data as { id: string }).id}`); else setErrors(r.fields ?? {});
  });
  const remove = () => { if (id && confirm("¿Eliminar este elemento y sus relaciones?")) start(async () => { const r = toast(await deleteCIAction(id)); if (r.ok) router.push("/cmdb"); }); };
  const t = f.type;
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={id ? `/cmdb/${id}` : "/cmdb"} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Volver</Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{id ? "Editar elemento" : "Nuevo elemento de configuración"}</h1>
      <Card className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
        <Field label="Nombre" htmlFor="n" required error={errors.name} className="sm:col-span-2"><Input id="n" value={f.name} onChange={set("name")} placeholder="Ej: SRV-SAP-PRD-01" /></Field>
        <Field label="Tipo" htmlFor="t"><Select id="t" value={f.type} onChange={set("type")}>{Object.entries(CI_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Criticidad" htmlFor="c" hint="¿Qué tan grave es para el negocio si falla?"><Select id="c" value={f.criticality} onChange={set("criticality")}>{["LOW", "MEDIUM", "HIGH"].map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</Select></Field>
        <Field label="Estado" htmlFor="s"><Select id="s" value={f.status} onChange={set("status")}>{Object.entries(CI_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Responsable" htmlFor="o"><Select id="o" value={f.ownerId} onChange={set("ownerId")}><option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Equipo de soporte" htmlFor="tm"><Select id="tm" value={f.teamId} onChange={set("teamId")}><option value="">—</option>{teams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        {["HARDWARE", "SERVER", "NETWORK"].includes(t) && <Field label="N° de serie" htmlFor="sr"><Input id="sr" value={f.serial} onChange={set("serial")} /></Field>}
        {["HARDWARE", "SERVER", "NETWORK", "DATABASE"].includes(t) && <Field label="Ubicación" htmlFor="lc"><Input id="lc" value={f.location} onChange={set("location")} /></Field>}
        {["SERVER", "NETWORK", "DATABASE"].includes(t) && <Field label="Dirección IP" htmlFor="ip"><Input id="ip" value={f.ipAddress} onChange={set("ipAddress")} /></Field>}
        {["SERVER", "APPLICATION", "DATABASE", "LICENSE"].includes(t) && <Field label="Versión" htmlFor="v"><Input id="v" value={f.version} onChange={set("version")} /></Field>}
        {t === "LICENSE" && <>
          <Field label="Licencias disponibles" htmlFor="se"><Input id="se" type="number" min={0} value={f.seats} onChange={set("seats")} /></Field>
          <Field label="Licencias usadas" htmlFor="su" error={errors.seatsUsed}><Input id="su" type="number" min={0} value={f.seatsUsed} onChange={set("seatsUsed")} /></Field>
        </>}
        {["LICENSE", "VENDOR", "HARDWARE"].includes(t) && <Field label={t === "VENDOR" ? "Fin de contrato" : t === "LICENSE" ? "Vencimiento" : "Fin de garantía"} htmlFor="ex" error={errors.expiresAt}><Input id="ex" type="date" value={f.expiresAt} onChange={set("expiresAt")} /></Field>}
        {t === "VENDOR" && <Field label="Contacto / soporte" htmlFor="ct" className="sm:col-span-2"><Input id="ct" value={f.contact} onChange={set("contact")} placeholder="Mesa de soporte, teléfono, correo, SLA contratado" /></Field>}
        <Field label="Descripción" htmlFor="d" className="sm:col-span-2"><Textarea id="d" rows={3} value={f.description} onChange={set("description")} /></Field>
        <div className="flex items-center justify-between border-t border-border pt-4 sm:col-span-2">
          {id ? <Button variant="ghost" className="text-red-600" onClick={remove} disabled={pending}><Trash2 className="h-4 w-4" />Eliminar</Button> : <span />}
          <Button onClick={save} loading={pending}>Guardar</Button>
        </div>
      </Card>
    </div>
  );
}
