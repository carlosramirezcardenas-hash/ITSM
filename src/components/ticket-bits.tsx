import { AlertTriangle, CheckCircle2, Clock, PauseCircle } from "lucide-react";
import { Badge } from "./ui";
import { PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE, STATUS_USER_LABEL } from "@/lib/labels";
import { slaState } from "@/lib/sla-calc";
import { formatMinutes } from "@/lib/utils";

export function StatusBadge({ status, simple }: { status: string; simple?: boolean }) {
  return <Badge tone={STATUS_TONE[status]} dot>{simple ? STATUS_USER_LABEL[status] : STATUS_LABEL[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{priority} · {PRIORITY_LABEL[priority]}</Badge>;
}

type SlaTicket = {
  resolutionDueAt: Date | null; resolvedAt: Date | null; resolutionBreached: boolean; createdAt: Date; slaPausedAt: Date | null; status: string;
};

export function SlaBadge({ t, warnPercent }: { t: SlaTicket; warnPercent?: number }) {
  if (t.slaPausedAt && !t.resolvedAt) return <Badge tone="slate"><PauseCircle className="h-3 w-3" />En pausa</Badge>;
  if (t.status === "CLOSED" && !t.resolvedAt) return null;
  const s = slaState(t.resolutionDueAt, t.resolvedAt, t.resolutionBreached, t.createdAt, warnPercent);
  if (s.state === "none") return null;
  const remaining = t.resolutionDueAt ? (t.resolutionDueAt.getTime() - Date.now()) / 60000 : 0;
  if (s.state === "met") return <Badge tone="green"><CheckCircle2 className="h-3 w-3" />SLA cumplido</Badge>;
  if (s.state === "breached") return <Badge tone="red"><AlertTriangle className="h-3 w-3" />{t.resolvedAt ? "SLA incumplido" : `Vencido hace ${formatMinutes(-remaining)}`}</Badge>;
  if (s.state === "warning") return <Badge tone="amber"><Clock className="h-3 w-3" />Vence en {formatMinutes(remaining)}</Badge>;
  return <Badge tone="slate"><Clock className="h-3 w-3" />{formatMinutes(remaining)}</Badge>;
}
