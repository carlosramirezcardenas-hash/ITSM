import { requireUser } from "@/server/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { ROLE_LABEL } from "@/lib/labels";
import { AppShell, type NavSection } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const sections: NavSection[] = [];

  if (user.role === "SUPER_ADMIN") {
    sections.push({ items: [{ href: "/platform", label: "Organizaciones", icon: "building" }] });
  } else {
    const r = user.role;
    const staff = can(r, "tickets:work");
    const [pendingApprovals, myOpen] = await Promise.all([
      can(r, "approvals:decide") ? db.approval.count({ where: { approverId: user.id, status: "PENDING", ticket: { orgId: user.orgId! } } }) : 0,
      staff ? db.ticket.count({ where: { orgId: user.orgId!, assigneeId: user.id, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"] } } }) : 0,
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
    if (can(r, "reports:view")) sections.push({ title: "Gestión", items: [{ href: "/reports", label: "Dashboard y reportes", icon: "chart" }] });
    const admin: NavSection = { title: "Administración", items: [] };
    if (can(r, "users:manage")) admin.items.push({ href: "/admin/users", label: "Usuarios", icon: "users" });
    if (can(r, "teams:manage")) admin.items.push({ href: "/admin/teams", label: "Equipos", icon: "teams" });
    if (can(r, "catalog:manage")) {
      admin.items.push({ href: "/admin/catalog", label: "Catálogo", icon: "grid" });
      admin.items.push({ href: "/admin/categories", label: "Categorías", icon: "tags" });
    }
    if (can(r, "sla:manage")) admin.items.push({ href: "/admin/sla", label: "SLA y horarios", icon: "timer" });
    if (can(r, "audit:view")) admin.items.push({ href: "/admin/audit", label: "Auditoría", icon: "audit" });
    if (can(r, "org:manage")) admin.items.push({ href: "/admin/settings", label: "Organización", icon: "settings" });
    if (admin.items.length) sections.push(admin);
  }

  return (
    <AppShell sections={sections} user={{ name: user.name, email: user.email, roleLabel: ROLE_LABEL[user.role]!, orgName: user.orgName }}>
      {children}
    </AppShell>
  );
}
