import type { Metadata } from "next";
import { requireCtx } from "@/server/auth";
import { ChangeForm } from "../change-form";
import { changeOptions } from "../change-options";

export const metadata: Metadata = { title: "Nuevo cambio" };

export default async function NewChange({ searchParams }: { searchParams: Promise<{ problem?: string }> }) {
  const ctx = await requireCtx("changes:create");
  const sp = await searchParams;
  const opts = await changeOptions(ctx.orgId);
  const problem = opts.problems.find((p) => p.id === sp.problem);
  return <ChangeForm {...opts} me={ctx.user.id} initial={problem ? { problemId: problem.id, title: `Solución definitiva PRB-${problem.number}: ${problem.title}`.slice(0, 160) } : {}} />;
}
