import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Organización" };

export default async function SettingsPage() {
  const ctx = await requireCtx("org:manage");
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, include: { _count: { select: { users: true, tickets: true, services: true } } } });
  const integrations = [
    ["Correo electrónico (entrada y salida)", "Fase 3"], ["Microsoft Teams", "Fase 3"], ["Inicio de sesión único (SSO / Entra ID)", "Fase 3"], ["API keys para integraciones", "Fase 3"],
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Organización" description={`Plan ${org.plan} · ${org._count.users} usuarios · ${org._count.tickets} tickets · ${org._count.services} servicios`} />
      <Card><CardHeader title="Datos generales" /><div className="p-5"><SettingsForm name={org.name} timezone={org.timezone} slug={org.slug} /></div></Card>
      <Card>
        <CardHeader title="Integraciones" description="Aún no disponibles en esta versión. Se habilitarán en la Fase 3 del roadmap." />
        <ul className="divide-y divide-border">{integrations.map(([n, p]) => <li key={n} className="flex items-center justify-between px-5 py-3 text-sm"><span>{n}</span><span className="text-xs text-muted">No implementado · {p}</span></li>)}</ul>
      </Card>
    </div>
  );
}
