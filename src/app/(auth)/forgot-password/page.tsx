"use client";
import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction } from "@/app/actions";
import { Button, Field, Input } from "@/components/ui";
import { ArrowLeft, MailCheck } from "lucide-react";

export default function ForgotPage() {
  const [state, action, pending] = useActionState(forgotPasswordAction, null);
  return (
    <div>
      <Link href="/login" className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Volver</Link>
      <h2 className="text-2xl font-semibold tracking-tight">Recupera tu acceso</h2>
      <p className="mt-1 text-sm text-muted">Te enviaremos un enlace para crear una contraseña nueva. Vence en 30 minutos.</p>
      {state?.ok ? (
        <div className="mt-8 space-y-3 rounded-xl border border-border bg-card p-4">
          <MailCheck className="h-5 w-5 text-emerald-500" />
          <p className="text-sm">{state.message}</p>
          {state.data?.demoLink && (
            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <strong>Modo demo:</strong> el envío de correos aún no está integrado (Fase 3). Usa este enlace:
              <Link href={state.data.demoLink} className="mt-1 block break-all font-medium text-primary underline">Restablecer contraseña</Link>
            </div>
          )}
        </div>
      ) : (
        <form action={action} className="mt-8 space-y-4">
          <Field label="Correo" htmlFor="email" error={state && !state.ok ? state.error : undefined}>
            <Input id="email" name="email" type="email" required placeholder="nombre@empresa.com" />
          </Field>
          <Button className="w-full" size="lg" loading={pending}>Enviar enlace</Button>
        </form>
      )}
    </div>
  );
}
