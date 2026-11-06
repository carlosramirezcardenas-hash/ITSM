import { NextResponse, type NextRequest } from "next/server";

// Primera barrera (rápida, en el edge): sin cookie de sesión → /login.
// La validación real de la sesión y permisos ocurre en el servidor (src/server/auth.ts).
const PUBLIC = ["/login", "/forgot-password", "/reset-password", "/api/health", "/api/cron"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Marca de ruta REST para autenticar claves de API; nunca se acepta desde el cliente
  const headers = new Headers(req.headers);
  headers.delete("x-itsm-api-route");
  const isApi = pathname.startsWith("/api/v1/");
  if (isApi) headers.set("x-itsm-api-route", "1");
  const next = () => NextResponse.next({ request: { headers } });
  if (PUBLIC.some((p) => pathname.startsWith(p))) return next();
  if (isApi && /^Bearer itsm_/.test(req.headers.get("authorization") ?? "")) return next();
  if (!req.cookies.get("itsm_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  return next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
