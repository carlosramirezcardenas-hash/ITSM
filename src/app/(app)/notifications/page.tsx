import Link from "next/link";
import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/server/auth";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { cn, timeAgo } from "@/lib/utils";
import { MarkAllRead } from "./mark-all";

export const metadata: Metadata = { title: "Notificaciones" };
export const dynamic = "force-dynamic";

const DOT: Record<string, string> = { danger: "bg-red-500", warning: "bg-amber-500", success: "bg-emerald-500", info: "bg-primary" };

export default async function NotificationsPage() {
  const u = await requireUser();
  const items = await db.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Notificaciones" description="Las últimas 100 novedades." action={items.some((i) => !i.readAt) ? <MarkAllRead /> : null} />
      <Card>
        {items.length === 0 ? <EmptyState icon={<Bell className="h-5 w-5" />} title="Sin notificaciones" /> : (
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const inner = (
                <div className={cn("flex gap-3 px-5 py-3.5", !n.readAt && "bg-primary-soft/40")}>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-border-strong" : DOT[n.kind] ?? DOT.info)} />
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium">{n.title}</p>{n.body && <p className="text-sm text-muted">{n.body}</p>}</div>
                  <span className="shrink-0 text-xs text-muted">{timeAgo(n.createdAt)}</span>
                </div>
              );
              return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-subtle">{inner}</Link> : inner}</li>;
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
