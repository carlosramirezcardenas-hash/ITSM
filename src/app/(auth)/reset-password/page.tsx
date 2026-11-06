"use client";
import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { resetPasswordAction } from "@/app/actions";
import { Button, Field, Input, buttonClass } from "@/components/ui";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  if (state?.ok) return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">¡Listo!</h2>
      <p className="text-sm text-muted">{state.message}</p>
      <Link href="/login" className={buttonClass("primary", "lg", "w-full")}>Ir a iniciar sesión</Link>
    </div>
  );
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Crea una contraseña nueva</h2>
      <p className="mt-1 text-sm text-muted">Mínimo 10 caracteres, con letras y números.</p>
      <form action={action} className="mt-8 space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="Nueva contraseña" htmlFor="password" error={state && !state.ok ? state.fields?.password : undefined}>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <Field label="Repite la contraseña" htmlFor="confirm" error={state && !state.ok ? state.fields?.confirm : undefined}>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        {state && !state.ok && !state.fields && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
        <Button className="w-full" size="lg" loading={pending} disabled={!token}>Guardar contraseña</Button>
        {!token && <p className="text-sm text-red-600">El enlace no es válido.</p>}
      </form>
    </div>
  );
}

export default function ResetPage() {
  return <Suspense><ResetForm /></Suspense>;
}
