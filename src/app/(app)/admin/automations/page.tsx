import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { AutomationsClient } from "./automations-client";

export const metadata: Metadata = { title: "Automatizaciones" };
export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const ctx = await requireCtx("catalog:manage");
  const [rules, teams, categories, users, depts] = await Promise.all([
    db.automationRule.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.category.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { orgId: ctx.orgId, isActive: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    db.department.findMany({ where: { orgId: ctx.orgId }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="Automatizaciones" description="Reglas «cuando… si… entonces…» que ahorran trabajo repetitivo. Se ejecutan en orden y quedan registradas en cada ticket." />
      <AutomationsClient
        rules={rules.map((r) => ({ id: r.id, name: r.name, description: r.description, trigger: r.trigger, conditions: r.conditions as never, actions: r.actions as never, isActive: r.isActive, runCount: r.runCount, lastRun: r.lastRunAt ? timeAgo(r.lastRunAt) : null }))}
        options={{ teams, categories, users, departments: depts.map((d) => d.name) }}
      />
    </div>
  );
}
