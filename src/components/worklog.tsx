import { Avatar } from "./ui";
import { timeAgo } from "@/lib/utils";
import { CHANGE_STATUS_LABEL, OUTCOME_LABEL, PROBLEM_STATUS_LABEL } from "@/lib/labels";
import { NoteComposer } from "./note-composer";

type Log = { id: string; action: string; note: string | null; createdAt: Date; actor: { name: string } | null };

function describe(action: string, entity: "problem" | "change") {
  const [kind, val] = action.split(":");
  const S = entity === "problem" ? PROBLEM_STATUS_LABEL : CHANGE_STATUS_LABEL;
  switch (kind) {
    case "created": return entity === "problem" ? "registró el problema" : "registró el cambio";
    case "updated": return "actualizó el cambio";
    case "status": return `cambió el estado a «${S[val!] ?? val}»`;
    case "field": return { rootCause: "documentó la causa raíz", workaround: "documentó la solución temporal", permanentFix: "documentó la solución definitiva" }[val!] ?? "editó";
    case "owner": return "cambió el responsable";
    case "incidents_linked": return "vinculó incidentes";
    case "incident_unlinked": return "desvinculó un incidente";
    case "incidents_resolved": return "resolvió en bloque los incidentes vinculados";
    case "task_added": return "agregó una acción al plan";
    case "task_done": return "completó una acción";
    case "task_reopened": return "reabrió una acción";
    case "kb_published": return "publicó la solución temporal en el centro de ayuda";
    case "kb_updated": return "actualizó el artículo de la solución temporal";
    case "approved": return `aprobó (nivel ${val})`;
    case "rejected": return `rechazó (nivel ${val})`;
    default: return action;
  }
}

export function WorkLog({ logs, entity, entityId }: { logs: Log[]; entity: "problem" | "change"; entityId: string }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Bitácora</h2>
      <ol className="space-y-2.5">
        {logs.map((l) => l.action === "note" ? (
          <li key={l.id} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-1.5 flex items-center gap-2 text-sm"><Avatar name={l.actor?.name ?? "Sistema"} size={22} /><span className="font-medium">{l.actor?.name}</span><span className="ml-auto text-xs text-muted">{timeAgo(l.createdAt)}</span></div>
            <p className="whitespace-pre-wrap text-sm">{l.note}</p>
          </li>
        ) : (
          <li key={l.id} className="flex items-start gap-2 px-2 text-xs text-muted">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
            <span className="flex-1"><strong className="font-medium text-fg/80">{l.actor?.name ?? "Sistema"}</strong> {describe(l.action, entity)}{l.note ? ` — ${l.note.length > 160 ? l.note.slice(0, 160) + "…" : l.note}` : ""}</span>
            <span className="shrink-0">{timeAgo(l.createdAt)}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4"><NoteComposer entity={entity} id={entityId} /></div>
    </section>
  );
}
export { OUTCOME_LABEL };
