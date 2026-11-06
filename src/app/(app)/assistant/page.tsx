import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { requireCtx } from "@/server/auth";
import { aiAvailable } from "@/server/ai";
import { AssistantChat } from "@/components/assistant-chat";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Asistente" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireCtx("tickets:create");
  const { q } = await searchParams;
  const ai = await aiAvailable(ctx.orgId);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300"><Sparkles className="h-5 w-5" /></span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Asistente</h1>
          <p className="text-sm text-muted">{ai ? "Con IA: entiende lo que necesitas, busca la solución y prepara tu solicitud." : "Busca en el catálogo y en el centro de ayuda, y prepara tu solicitud."}</p>
        </div>
      </div>
      <Card className="overflow-hidden">
        <AssistantChat firstName={ctx.user.name.split(" ")[0] ?? ""} initial={q?.slice(0, 1000)} />
      </Card>
    </div>
  );
}
