import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Avatar } from "./ui";
import { PriorityBadge, SlaBadge, StatusBadge } from "./ticket-bits";
import { ticketRef, timeAgo } from "@/lib/utils";

type Row = {
  id: string; number: number; type: string; title: string; status: string; priority: string; createdAt: Date; updatedAt: Date;
  resolutionDueAt: Date | null; resolvedAt: Date | null; resolutionBreached: boolean; slaPausedAt: Date | null;
  requester?: { name: string } | null; assignee?: { name: string } | null; approvalStatus?: string;
};

/** Fila compacta para el usuario final: lenguaje simple, sin SLA ni prioridad. */
export function SimpleTicketRow({ t }: { t: Row }) {
  return (
    <Link href={`/tickets/${t.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-subtle">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{t.title}</p>
        <p className="text-xs text-muted">{ticketRef(t.type, t.number)} · actualizado {timeAgo(t.updatedAt)}</p>
      </div>
      {t.approvalStatus === "PENDING" ? <span className="text-xs text-orange-600 dark:text-orange-400">Esperando aprobación</span> : <StatusBadge status={t.status} simple />}
      <ChevronRight className="h-4 w-4 text-muted" />
    </Link>
  );
}

/** Fila operativa para agentes. */
export function AgentTicketRow({ t, showAssignee = true }: { t: Row; showAssignee?: boolean }) {
  return (
    <Link href={`/tickets/${t.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-5 py-3 hover:bg-subtle md:grid-cols-[90px_1fr_auto_auto_auto]">
      <span className="hidden font-mono text-xs text-muted md:block">{ticketRef(t.type, t.number)}</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{t.title}</p>
        <p className="truncate text-xs text-muted"><span className="md:hidden">{ticketRef(t.type, t.number)} · </span>{t.requester?.name} · {timeAgo(t.createdAt)}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5 md:contents">
        <span className="md:order-none"><PriorityBadge priority={t.priority} /></span>
        <span><StatusBadge status={t.status} /></span>
        <span className="hidden items-center gap-2 md:flex">
          <SlaBadge t={t} />
          {showAssignee && (t.assignee ? <Avatar name={t.assignee.name} size={22} /> : <span className="h-[22px] w-[22px] rounded-full border border-dashed border-border-strong" title="Sin asignar" />)}
        </span>
      </div>
    </Link>
  );
}
