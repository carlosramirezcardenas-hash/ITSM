import { requireUser } from "@/server/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ROLE_LABEL } from "@/lib/labels";
import { AppShell, type NavSection } from "@/components/app-shell";
import { after } from "next/server";
import { maybeRunSlaSweep } from "@/server/sla";
import { PortalShell, type PortalNavItem } from "@/components/portal-shell";
import { canUseOps, getExperience } from "@/server/experience";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  after(() => maybeRunSlaSweep().catch((e) => console.error("[sla-sweep]", e)));
  const sections: NavSection[] = [];
  const shellUser = { name: user.name, email: user.email, roleLabel: ROLE_LABEL[user.role]!, orgName: user.orgName };

  if (user.role !== "SUPER_ADMIN" && (await getExperience(user.role)) === "employee") {
    // Portal del empleado: solo lo que una persona necesita para pedir ayuda y seguir lo que pidió.
    const pendingApprovals = can(user.role, "approvals:decide")
      ? await db.approval.count({ where: { approverId: user.id, status: "PENDING", ticket: { orgId: user.orgId! } } }) : 0;
    const items: PortalNavItem[] = [
      { href: "/home", label: "Inicio", icon: "home" },
      { href: "/catalog", label: "Servicios", icon: "grid" },
      { href: "/my-requests", label: "Mis solicitudes", icon: "list" },
      ...(can(user.role, "approvals:decide") ? [{ href: "/approvals", label: "Aprobaciones", icon: "check" as const, badge: pendingApprovals }] : []),
      { href: "/help", label: "Ayuda", icon: "book" },
    ];
    return <PortalShell items={items} user={shellUser} canSwitch={canUseOps(user.role)}>{children}</PortalShell>;
  }

  if (user.role === "SUPER_ADMIN") {
    sections.push({ items: [{ href: "/platform", label: "Organizaciones", icon: "building" }] });
  } else {
    const r = user.role;
    const staff = can(r, "tickets:work");
    const [pendingApprovals, myOpen, pendingChanges] = await Promise.all([
      can(r, "approvals:decide") ? db.approval.count({ where: { approverId: user.id, status: "PENDING", ticket: { orgId: user.orgId! } } }) : 0,
      staff ? db.ticket.count({ where: { orgId: user.orgId!, assigneeId: user.id, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] } } }) : 0,
      can(r, "changes:approve") ? db.changeApproval.count({ where: { approverId: user.id, status: "PENDING", change: { orgId: user.orgId!, status: "PENDING_APPROVAL" } } }) : 0,
    ]);
    sections.push({
      items: [
        { href: "/new", label: staff ? "Registrar ticket" : "Crear solicitud", icon: "plus", primary: true },
        { href: "/home", label: "Inicio", icon: "home" },
        ...(staff ? [{ href: "/queue", label: "Bandeja de trabajo", icon: "inbox" as const, badge: myOpen }] : []),
        { href: "/my-requests", label: "Mis solicitudes", icon: "list" },
        ...(can(r, "approvals:decide") ? [{ href: "/approvals", label: "Aprobaciones", icon: "check" as const, badge: pendingApprovals }] : []),
        { href: "/catalog", label: "Catálogo de servicios", icon: "grid" },
        { href: "/help", label: "Centro de ayuda", icon: "book" },
      ],
    });
    const mgmt: NavSection = { title: "Gestión ITSM", items: [] };
    if (can(r, "problems:manage")) mgmt.items.push({ href: "/problems", label: "Problemas", icon: "bug" });
    if (can(r, "changes:create")) mgmt.items.push({ href: "/changes", label: "Cambios", icon: "change", badge: pendingChanges });
    if (can(r, "cmdb:view")) mgmt.items.push({ href: "/cmdb", label: "CMDB", icon: "cmdb" });
    if (can(r, "kb:manage")) mgmt.items.push({ href: "/help/gaps", label: "Lo que falta en ayuda", icon: "searchx" });
    if (can(r, "reports:view")) mgmt.items.push({ href: "/reports", label: "Dashboard y reportes", icon: "chart" });
    if (mgmt.items.length) sections.push(mgmt);
    const admin: NavSection = { title: "Administración", items: [] };
    if (can(r, "users:manage")) admin.items.push({ href: "/admin/users", label: "Usuarios", icon: "users" });
    if (can(r, "teams:manage")) admin.items.push({ href: "/admin/teams", label: "Equipos", icon: "teams" });
    if (can(r, "catalog:manage")) {
      admin.items.push({ href: "/admin/catalog", label: "Catálogo", icon: "grid" });
      admin.items.push({ href: "/admin/categories", label: "Categorías", icon: "tags" });
    }
    if (can(r, "sla:manage")) admin.items.push({ href: "/admin/sla", label: "SLA y horarios", icon: "timer" });
    if (can(r, "catalog:manage")) admin.items.push({ href: "/admin/automations", label: "Automatizaciones", icon: "workflow" });
    if (can(r, "catalog:manage")) admin.items.push({ href: "/admin/assistant", label: "Asistente y aprendizaje", icon: "bot" });
    if (can(r, "org:manage")) admin.items.push({ href: "/admin/integrations", label: "Integraciones e IA", icon: "plug" });
    if (can(r, "audit:view")) admin.items.push({ href: "/admin/audit", label: "Auditoría", icon: "audit" });
    if (can(r, "org:manage")) admin.items.push({ href: "/admin/settings", label: "Organización", icon: "settings" });
    if (admin.items.length) sections.push(admin);
  }

  return (
    <AppShell sections={sections} user={shellUser} canSwitch={user.role !== "SUPER_ADMIN" && canUseOps(user.role)}>
      {children}
    </AppShell>
  );
}
