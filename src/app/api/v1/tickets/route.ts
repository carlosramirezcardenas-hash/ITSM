import { getCtx } from "@/server/auth";
import { api } from "@/server/api";
import { createIncident, createRequest, listTickets } from "@/server/tickets";

export const dynamic = "force-dynamic";

/** GET /api/v1/tickets?view=mine&status=open&type=INCIDENT&q=&page=1 */
export const GET = api(async (req: Request) => {
  const ctx = await getCtx();
  return listTickets(ctx, Object.fromEntries(new URL(req.url).searchParams));
});

/** POST /api/v1/tickets  { type: "INCIDENT", title, description, impact, urgency } | { type: "REQUEST", serviceItemId, answers } */
export const POST = api(async (req: Request) => {
  const ctx = await getCtx("tickets:create");
  const body = await req.json();
  const t = body?.type === "REQUEST" ? await createRequest(ctx, body) : await createIncident(ctx, body);
  return Response.json(t, { status: 201 });
});
