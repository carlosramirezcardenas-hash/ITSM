"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changePasswordAction, revokeSessionAction } from "@/app/actions";
import { Button, Field, Input } from "@/components/ui";
import { useActionToast } from "@/components/toast";

export function ChangePassword() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (f.next !== f.confirm) { setErrors({ confirm: "No coincide." }); return; }
    start(async () => {
      const r = toast(await changePasswordAction({ current: f.current, next: f.next }));
      if (r.ok) { setF({ current: "", next: "", confirm: "" }); setErrors({}); } else setErrors(r.fields ?? {});
    });
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
      <Field label="Contraseña actual" htmlFor="cur" error={errors.current}><Input id="cur" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></Field>
      <Field label="Nueva" htmlFor="nw" error={errors.next} hint="Mín. 10, letras y números"><Input id="nw" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required /></Field>
      <Field label="Repetir nueva" htmlFor="cf" error={errors.confirm}><Input id="cf" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></Field>
      <div className="sm:col-span-3"><Button loading={pending} disabled={!f.current || !f.next}>Actualizar contraseña</Button></div>
    </form>
  );
}

export function RevokeSession({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const toast = useActionToast();
  const router = useRouter();
  return <Button size="sm" variant="outline" loading={pending} onClick={() => start(async () => { const r = toast(await revokeSessionAction(id)); if (r.ok) router.refresh(); })}>Cerrar sesión</Button>;
}
