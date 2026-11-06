import Link from "next/link";
import { Badge, EmptyState } from "./ui";
import { ticketRef } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

type Item = { id: string; number: number; type: string; title: string; priority: string; assignee: { name: string } | null; risk: { score: number; level: string; reasons: string[] } };

/** Lista de tickets con riesgo de incumplir el SLA (modelo explicable en src/lib/predict.ts). */
export function RiskList({ items }: { items: Item[] }) {
  if (!items.length) return <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="Sin riesgos relevantes" description="Ningún ticket abierto tiene riesgo medio o alto de vencer." />;
  return (
    <ul className="divide-y divide-border">
      {items.map((t) => (
        <li key={t.id}>
          <Link href={`/tickets/${t.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-subtle">
            <span className="w-10 text-right text-sm font-semibold tabular-nums">{t.risk.score}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{ticketRef(t.type, t.number)} · {t.title}</span>
              <span className="block truncate text-xs text-muted">{t.risk.reasons.join(" · ") || "—"}{t.assignee ? ` · ${t.assignee.name}` : ""}</span>
            </span>
            <Badge tone={t.risk.level === "breached" ? "red" : t.risk.level === "high" ? "red" : "amber"}>{t.risk.level === "breached" ? "Vencido" : t.risk.level === "high" ? "Alto" : "Medio"}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
