import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth";
import { listUsers } from "@/server/admin";
import { PageHeader } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { UsersClient } from "./users-client";

export const metadata: Metadata = { title: "Usuarios" };
export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireCtx("users:manage");
  const { q } = await searchParams;
  const [users, departments, teams, all] = await Promise.all([
    listUsers(ctx, q),
    db.department.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" } }),
    db.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { orgId: ctx.orgId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div>
      <PageHeader title="Usuarios" description={`${users.length} persona(s) en tu organización`} />
      <UsersClient
        q={q ?? ""} me={ctx.user.id}
        users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, title: u.title, departmentId: u.departmentId, department: u.department?.name ?? null, managerId: u.managerId, manager: u.manager?.name ?? null, isActive: u.isActive, lastLogin: u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Nunca", teamIds: u.memberships.map((m) => m.teamId), teams: u.memberships.map((m) => m.team.name) }))}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))} teams={teams} people={all}
      />
    </div>
  );
}
