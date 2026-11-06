import { getCtx } from "@/server/auth";
import { api } from "@/server/api";
import { addComment } from "@/server/tickets";

export const dynamic = "force-dynamic";

/** POST { body, isInternal? } */
export const POST = api(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const c = await addComment(await getCtx(), (await params).id, await req.json());
  return Response.json(c, { status: 201 });
});
