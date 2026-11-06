import type { Metadata } from "next";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { requireCtx } from "@/server/auth";
import { IssueForm } from "./issue-form";

export const metadata: Metadata = { title: "Reportar un problema" };

export default async function IssuePage() {
  const ctx = await requireCtx("tickets:create");
  const staff = can(ctx.user.role, "tickets:work");
  const [users, categories] = staff
    ? await Promise.all([
        db.user.findMany({ where: { orgId: ctx.orgId, isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
        db.category.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ])
    : [[], []];
  return <IssueForm staff={staff} users={users} categories={categories} me={ctx.user.id} />;
}
