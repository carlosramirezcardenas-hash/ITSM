"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOrgSettingsAction } from "@/app/actions";
import { Button, Field, Input } from "@/components/ui";
import { useActionToast } from "@/components/toast";

export function SettingsForm({ name, timezone, slug }: { name: string; timezone: string; slug: string }) {
  const [f, setF] = useState({ name, timezone });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  return (
    <form onSubmit={(e) => { e.preventDefault(); start(async () => { const r = toast(await saveOrgSettingsAction(f)); if (r.ok) router.refresh(); else setErrors(r.fields ?? {}); }); }} className="grid gap-4 sm:grid-cols-2">
      <Field label="Nombre" htmlFor="on" error={errors.name}><Input id="on" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Zona horaria" htmlFor="otz" error={errors.timezone}><Input id="otz" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
      <Field label="Identificador (espacio de trabajo)" hint="No editable"><Input value={slug} disabled /></Field>
      <div className="flex items-end"><Button loading={pending}>Guardar</Button></div>
    </form>
  );
}
