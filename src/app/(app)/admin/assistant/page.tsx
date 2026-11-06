import type { Metadata } from "next";
import { requireCtx } from "@/server/auth";
import { learningOverview } from "@/server/learning-admin";
import { aiAvailable } from "@/server/ai";
import { PageHeader, Stat } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { LearningClient } from "./learning-client";

export const metadata: Metadata = { title: "Asistente y aprendizaje" };
export const dynamic = "force-dynamic";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function AssistantAdminPage() {
  const ctx = await requireCtx("catalog:manage");
  const [o, ai] = await Promise.all([learningOverview(ctx), aiAvailable(ctx.orgId)]);
  const s = o.stats;
  return (
    <div className="space-y-6">
      <PageHeader title="Asistente y aprendizaje"
        description={`Lo que el asistente del portal aprendió de las conversaciones y de los casos resueltos. Todo se puede revisar, corregir u ocultar. Modo actual: ${ai ? "con IA" : "básico (sin IA)"}.`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Conversaciones (30 días)" value={s.total} />
        <Stat label="Resueltas sin ticket" value={pct(s.selfResolved, s.total)} sub={`${s.selfResolved} con guía o solución`} tone={s.selfResolved > 0 ? "good" : undefined} />
        <Stat label="Llevadas al catálogo" value={s.toService} sub="clic en «Solicitar»" />
        <Stat label="Reportes enviados" value={s.toTicket} sub="desde el chat" />
        <Stat label="Le sirvió" value={pct(s.up, s.up + s.down)} sub={`${s.up} 👍 · ${s.down} 👎`} tone={s.up + s.down === 0 ? undefined : s.up >= s.down ? "good" : "warn"} />
      </div>
      <LearningClient
        solutions={o.solutions.map((x) => ({
          id: x.id, title: x.title, resolution: x.resolution, status: x.status, hiddenReason: x.hiddenReason, manual: x.manual,
          cases: x.ticketIds.length, shown: x.shown, helpful: x.helpful, notHelpful: x.notHelpful, category: x.category?.name ?? null, updated: timeAgo(x.updatedAt),
        }))}
        terms={o.terms.map((t) => ({ id: t.id, term: t.term, targetType: t.targetType, targetName: t.targetName!, positive: t.positive, negative: t.negative, disabled: t.disabled }))}
        unanswered={o.recentBad.map((q) => ({ id: q.id, query: q.query, feedback: q.feedback, when: timeAgo(q.createdAt) }))}
      />
    </div>
  );
}
