import { getCtx } from "@/server/auth";
import { api } from "@/server/api";
import { getTicket, updateTicket } from "@/server/tickets";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const GET = api(async (_: Request, { params }: P) => getTicket(await getCtx(), (await params).id));

/** PATCH { status?, assigneeId?, teamId?, impact?, urgency?, categoryId?, pendingReason?, resolution? } */
export const PATCH = api(async (req: Request, { params }: P) => updateTicket(await getCtx("tickets:work"), (await params).id, await req.json()));
