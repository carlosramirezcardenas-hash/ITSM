import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireCtx } from "@/server/auth";
import { knowledgeGaps } from "@/server/kb-gaps";
import { aiAvailable } from "@/server/ai";
import { PageHeader } from "@/components/ui";
import { GapsClient } from "./gaps-client";

export const metadata: Metadata = { title: "Lo que falta en el centro de ayuda" };
export const dynamic = "force-dynamic";

export default async function GapsPage() {
  const ctx = await requireCtx("kb:manage");
  const [gaps, ai] = await Promise.all([knowledgeGaps(ctx), aiAvailable(ctx.orgId)]);
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/help" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Centro de ayuda</Link>
      <PageHeader title="Lo que falta en el centro de ayuda"
        description="Temas de los últimos 30 días que la gente preguntó al asistente o reportó como incidente y ninguna guía cubre. Ordenados por personas afectadas." />
      <GapsClient gaps={gaps} ai={ai} />
    </div>
  );
}
