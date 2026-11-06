"use client";
import { useActionState, useRef } from "react";
import Link from "next/link";
import { loginAction } from "@/app/actions";
import { Button, Field, Input } from "@/components/ui";

const DEMO = [
  { email: "ana@andes.demo", label: "Ana Torres", role: "Usuaria final" },
  { email: "camila@andes.demo", label: "Camila Soto", role: "Agente de soporte" },
  { email: "patricia@andes.demo", label: "Patricia Lagos", role: "Aprobadora" },
  { email: "gestor@andes.demo", label: "Martín Fuentes", role: "Gestor de servicios" },
  { email: "admin@andes.demo", label: "Valentina Rojas", role: "Administradora" },
  { email: "root@itsmeasy.app", label: "Operaciones SaaS", role: "Superadmin" },
];

export function LoginForm({ next, demo }: { next: string; demo: boolean }) {
  const [state, action, pending] = useActionState(loginAction, null);
  const email = useRef<HTMLInputElement>(null);
  const pw = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Bienvenido de vuelta</h2>
      <p className="mt-1 text-sm text-muted">Ingresa con tu correo de trabajo.</p>
      <form ref={formRef} action={action} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Correo" htmlFor="email">
          <Input ref={email} id="email" name="email" type="email" autoComplete="username" required placeholder="nombre@empresa.com" />
        </Field>
        <Field label="Contraseña" htmlFor="password">
          <Input ref={pw} id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        {state && !state.ok && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300" role="alert">{state.error}</p>}
        <Button type="submit" className="w-full" size="lg" loading={pending}>Iniciar sesión</Button>
        <p className="text-center text-sm"><Link href="/forgot-password" className="text-primary hover:underline">¿Olvidaste tu contraseña?</Link></p>
      </form>

      {demo && (
        <div className="mt-10 rounded-xl border border-dashed border-border p-4">
          <p className="text-xs font-medium text-muted">Cuentas de demostración · contraseña <code className="rounded bg-subtle px-1">Demo12345!</code></p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {DEMO.map((d) => (
              <button key={d.email} type="button" disabled={pending}
                onClick={() => { email.current!.value = d.email; pw.current!.value = "Demo12345!"; formRef.current!.requestSubmit(); }}
                className="rounded-lg border border-border bg-card px-2.5 py-2 text-left hover:border-primary hover:bg-primary-soft/40">
                <span className="block text-[13px] font-medium">{d.label}</span>
                <span className="block text-[11px] text-muted">{d.role}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
