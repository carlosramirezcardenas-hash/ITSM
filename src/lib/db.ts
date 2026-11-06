import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Con poolers en modo transacción (Neon «-pooler», Supabase :6543) Prisma necesita pgbouncer=true. */
function datasourceUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  const pooled = /-pooler\.|pooler\.supabase|:6543\//.test(url);
  return pooled && !/[?&]pgbouncer=/.test(url) ? `${url}${url.includes("?") ? "&" : "?"}pgbouncer=true` : url;
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ datasourceUrl: datasourceUrl(), log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
