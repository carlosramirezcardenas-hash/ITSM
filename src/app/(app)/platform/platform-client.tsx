"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createOrganizationAction, setOrganizationActiveAction } from "@/app/actions";
import { Button, Field, Input, Select } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useActionToast } from "@/components/toast";
import { slugify } from "@/lib/utils";

export function NewOrg() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", slug: "", plan: "starter", adminName: "", adminEmail: "", adminPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  const save = () => start(async () => { const r = toast(await createOrganizationAction(f)); if (r.ok) { setOpen(false); router.refresh(); } else setErrors(r.fields ?? {}); });
  return (
    <>
      <Button onClick={() => { setOpen(true); setErrors({}); }}><Plus className="h-4 w-4" />Nueva organización</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva organización" description="Se crea con su administrador, calendario laboral, políticas SLA base y una mesa de ayuda."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={pending} onClick={save}>Crear</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre de la empresa" htmlFor="on" required error={errors.name}><Input id="on" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slug || slugify(e.target.value) })} /></Field>
          <Field label="Identificador" htmlFor="os" required error={errors.slug}><Input id="os" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
          <Field label="Plan" htmlFor="op"><Select id="op" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}><option value="starter">Starter</option><option value="business">Business</option><option value="enterprise">Enterprise</option></Select></Field>
          <div />
          <Field label="Nombre del administrador" htmlFor="an" required error={errors.adminName}><Input id="an" value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} /></Field>
          <Field label="Correo del administrador" htmlFor="ae" required error={errors.adminEmail}><Input id="ae" type="email" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} /></Field>
          <Field label="Contraseña inicial" htmlFor="ap" required error={errors.adminPassword ?? errors.password} hint="Mín. 10, letras y números"><Input id="ap" type="password" value={f.adminPassword} onChange={(e) => setF({ ...f, adminPassword: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function OrgActions({ id, active, name }: { id: string; active: boolean; name: string }) {
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  return (
    <Button size="sm" variant={active ? "ghost" : "outline"} className={active ? "text-red-600" : ""} loading={pending}
      onClick={() => { if (!active || confirm(`¿Suspender «${name}»? Sus usuarios perderán el acceso inmediatamente.`)) start(async () => { const r = toast(await setOrganizationActiveAction(id, !active)); if (r.ok) router.refresh(); }); }}>
      {active ? "Suspender" : "Reactivar"}
    </Button>
  );
}
