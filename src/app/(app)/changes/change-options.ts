import { db } from "@/lib/db";

export async function changeOptions(orgId: string) {
  const [cis, staff, teams, problems] = await Promise.all([
    db.configItem.findMany({ where: { orgId, status: { not: "RETIRED" } }, select: { id: true, name: true, type: true, criticality: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.user.findMany({ where: { orgId, isActive: true, role: { in: ["AGENT", "SERVICE_MANAGER", "ORG_ADMIN"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.team.findMany({ where: { orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.problem.findMany({ where: { orgId, status: { not: "CLOSED" } }, select: { id: true, number: true, title: true }, orderBy: { number: "desc" } }),
  ]);
  return { cis, staff, teams, problems };
}
