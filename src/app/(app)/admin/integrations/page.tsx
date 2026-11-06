import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { aiConfigured, AI_MODEL } from "@/server/ai";
import { emailConfigured } from "@/server/email";
import { maskUrl } from "@/server/integrations";
import { PageHeader } from "@/components/ui";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { IntegrationsClient } from "./integrations-client";

export const metadata: Metadata = { title: "Integraciones" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const ctx = await requireCtx("org:manage");
  const since = new Date(Date.now() - 30 * 86400_000);
  const [org, integrations, keys, usage] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { aiEnabled: true } }),
    db.integration.findMany({ where: { orgId: ctx.orgId }, include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } }, orderBy: { createdAt: "asc" } }),
    db.apiKey.findMany({ where: { orgId: ctx.orgId }, include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    db.aiUsage.groupBy({ by: ["feature"], where: { orgId: ctx.orgId, createdAt: { gte: since } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
  ]);
  const failures = await db.aiUsage.count({ where: { orgId: ctx.orgId, createdAt: { gte: since }, ok: false } });
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Integraciones e inteligencia artificial" description="Conecta ITSM Easy con tus herramientas, administra el acceso a la API y el asistente de IA." />
      <IntegrationsClient
        ai={{ configured: aiConfigured(), enabled: org.aiEnabled, model: AI_MODEL, failures, usage: usage.map((u) => ({ feature: u.feature, calls: u._count._all, input: u._sum.inputTokens ?? 0, output: u._sum.outputTokens ?? 0 })) }}
        email={{ configured: emailConfigured(), from: process.env.EMAIL_FROM ?? null }}
        integrations={integrations.map((i) => ({ id: i.id, type: i.type, name: i.name, events: i.events, isActive: i.isActive, url: maskUrl(i.configEnc), lastDelivery: i.lastDeliveryAt ? timeAgo(i.lastDeliveryAt) : null, lastStatus: i.lastStatus, deliveries: i.deliveries.map((d) => ({ id: d.id, event: d.event, ok: d.ok, status: d.status, error: d.error, at: d.createdAt.toISOString() })) }))}
        keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scope: k.scope, createdBy: k.createdBy.name, lastUsed: k.lastUsedAt ? timeAgo(k.lastUsedAt) : null, revoked: !!k.revokedAt, expires: k.expiresAt ? formatDateTime(k.expiresAt) : null, created: timeAgo(k.createdAt) }))}
      />
    </div>
  );
}
