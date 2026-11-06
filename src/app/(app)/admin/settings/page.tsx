import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Organización" };

export default async function SettingsPage() {
  const ctx = await requireCtx("org:manage");
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, include: { _count: { select: { users: true, tickets: true, services: true } } } });
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Organización" description={`Plan ${org.plan} · ${org._count.users} usuarios · ${org._count.tickets} tickets · ${org._count.services} servicios`} />
      <Card><CardHeader title="Datos generales" /><div className="p-5"><SettingsForm name={org.name} timezone={org.timezone} slug={org.slug} /></div></Card>
      <Card className="p-5 text-sm">
        <p className="font-medium">Integraciones, API e inteligencia artificial</p>
        <p className="mt-1 text-muted">Microsoft Teams, Slack, webhooks, claves de API, correo y asistente de IA se administran en <a href="/admin/integrations" className="text-primary hover:underline">Integraciones e IA</a>.</p>
      </Card>
    </div>
  );
}
