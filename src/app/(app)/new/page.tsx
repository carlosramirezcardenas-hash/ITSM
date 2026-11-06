import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Clock, KeyRound, LifeBuoy, PackagePlus, Wrench } from "lucide-react";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { DynIcon } from "@/components/icon";

export const metadata: Metadata = { title: "Crear solicitud" };

export default async function NewPage() {
  const ctx = await requireCtx("tickets:create");
  const popular = await db.serviceItem.findMany({ where: { orgId: ctx.orgId, isActive: true }, orderBy: { popularity: "desc" }, take: 4, select: { id: true, name: true, icon: true, estimatedHours: true } });
  const options = [
    { href: "/new/issue", icon: Wrench, title: "Tengo un problema", desc: "Algo dejó de funcionar o funciona mal: correo, internet, impresora, un sistema…", tone: "bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-300" },
    { href: "/catalog", icon: PackagePlus, title: "Quiero solicitar algo", desc: "Un equipo, un programa, accesorios o cualquier servicio del catálogo.", tone: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300" },
    { href: "/catalog?c=access", icon: KeyRound, title: "Necesito acceso", desc: "A un sistema, una carpeta compartida, VPN o recuperar mi contraseña.", tone: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300" },
    { href: "/help", icon: LifeBuoy, title: "Necesito ayuda", desc: "Encuentra la respuesta al instante en guías paso a paso.", tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300" },
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">¿Qué necesitas?</h1>
      <p className="mt-1 text-sm text-muted">Elige una opción. Te tomará menos de 30 segundos.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {options.map((o) => (
          <Link key={o.title} href={o.href} className="group flex gap-4 rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${o.tone}`}><o.icon className="h-5 w-5" /></span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 font-medium">{o.title}<ArrowRight className="h-4 w-4 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" /></span>
              <span className="mt-1 block text-sm text-muted">{o.desc}</span>
            </span>
          </Link>
        ))}
      </div>
      <h2 className="mb-3 mt-10 text-sm font-semibold">Lo más pedido</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {popular.map((s) => (
          <Link key={s.id} href={`/catalog/${s.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-subtle">
            <DynIcon name={s.icon} className="h-4 w-4 text-primary" />
            <span className="flex-1 text-sm">{s.name}</span>
            <span className="flex items-center gap-1 text-xs text-muted"><Clock className="h-3 w-3" />~{s.estimatedHours < 24 ? `${s.estimatedHours} h` : `${Math.round(s.estimatedHours / 24)} d`}</span>
          </Link>
        ))}
      </div>
      <p className="mt-8 text-center text-sm text-muted">¿Quieres saber cómo va algo que ya pediste? <Link href="/my-requests" className="text-primary hover:underline">Revisa tus solicitudes</Link></p>
    </div>
  );
}
