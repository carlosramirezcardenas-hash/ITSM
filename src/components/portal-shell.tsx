"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, CheckSquare, ChevronDown, Home, LayoutGrid, ListChecks, LogOut, Menu, Sparkles, UserCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui";
import { ThemeToggle } from "./theme-toggle";
import { NotificationBell } from "./notification-bell";
import { CommandPalette, SearchButton } from "./command-palette";
import { ExperienceSwitch } from "./experience-switch";
import { AssistantChat } from "./assistant-chat";
import { logoutAction } from "@/app/actions";

const ICONS = { home: Home, grid: LayoutGrid, list: ListChecks, book: BookOpen, check: CheckSquare };
export type PortalNavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

/** Portal del empleado: navegación superior simple, sin módulos de TI, con el asistente siempre a mano. */
export function PortalShell({ items, user, canSwitch, children }: {
  items: PortalNavItem[];
  user: { name: string; email: string; roleLabel: string; orgName: string | null };
  canSwitch: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMounted, setChatMounted] = useState(false); // la conversación se conserva al navegar
  useEffect(() => { if (chatOpen) setChatMounted(true); }, [chatOpen]);
  useEffect(() => { setMobileOpen(false); setMenuOpen(false); setChatOpen(false); }, [pathname]);
  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setChatOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chatOpen]);

  const isActive = (href: string) => href === "/home" ? pathname === "/home" : pathname === href || pathname.startsWith(href + "/");
  const first = user.name.split(" ")[0] ?? "";
  const onAssistantPage = pathname === "/assistant";

  const link = (it: PortalNavItem, mobile = false) => {
    const I = ICONS[it.icon];
    const active = isActive(it.href);
    return (
      <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
        className={cn("flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
          active ? "bg-subtle font-medium text-fg" : "text-muted hover:bg-subtle/60 hover:text-fg", mobile && "py-2.5")}>
        <I className="h-4 w-4 shrink-0" />{it.label}
        {!!it.badge && <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-semibold text-primary">{it.badge}</span>}
      </Link>
    );
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="-ml-1 rounded-md p-1.5 text-muted lg:hidden" aria-label="Abrir menú"><Menu className="h-5 w-5" /></button>
          <Link href="/home" className="mr-2 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-fg"><Sparkles className="h-4 w-4" /></span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-sm font-semibold">ITSM Easy</span>
              <span className="block max-w-[10rem] truncate text-[11px] text-muted">{user.orgName}</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Principal">{items.map((it) => link(it))}</nav>
          <div className="flex-1" />
          {canSwitch && <ExperienceSwitch current="employee" className="hidden md:flex" />}
          <SearchButton className="hidden w-48 xl:flex" />
          <ThemeToggle />
          <NotificationBell />
          <div className="relative">
            <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-1 rounded-full p-0.5 hover:bg-subtle" aria-expanded={menuOpen} aria-label="Menú de usuario">
              <Avatar name={user.name} size={30} /><ChevronDown className="hidden h-4 w-4 text-muted sm:block" />
            </button>
            {menuOpen && (
              <div className="animate-in absolute right-0 top-full mt-1 w-64 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-xl">
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted">{user.email}</p>
                </div>
                {canSwitch && <div className="border-t border-border px-3 py-2 md:hidden"><ExperienceSwitch current="employee" /></div>}
                <Link href="/profile" className="flex items-center gap-2 border-t border-border px-3 py-2 text-sm hover:bg-subtle"><UserCircle className="h-4 w-4" />Mi perfil y seguridad</Link>
                <form action={logoutAction}>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-subtle"><LogOut className="h-4 w-4" />Cerrar sesión</button>
                </form>
              </div>
            )}
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="animate-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-1 border-r border-border bg-sidebar p-3">
            <button onClick={() => setMobileOpen(false)} className="ml-auto rounded-md p-1 text-muted" aria-label="Cerrar menú"><X className="h-5 w-5" /></button>
            {items.map((it) => link(it, true))}
            <Link href="/assistant" className="mt-2 flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-medium text-white"><Sparkles className="h-4 w-4" />Asistente</Link>
            {canSwitch && <div className="mt-auto"><ExperienceSwitch current="employee" /></div>}
          </aside>
        </div>
      )}

      <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>

      {!onAssistantPage && (
        <>
          {chatMounted && (
            <div role="dialog" aria-label="Asistente" hidden={!chatOpen} className="animate-in fixed inset-x-0 bottom-0 z-50 flex h-[80dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:inset-x-auto sm:bottom-20 sm:right-6 sm:h-[34rem] sm:w-[24rem] sm:rounded-2xl">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Sparkles className="h-4 w-4 text-violet-500" />
                <p className="flex-1 text-sm font-semibold">Asistente</p>
                <Link href="/assistant" className="text-xs text-muted hover:text-fg">Pantalla completa</Link>
                <button onClick={() => setChatOpen(false)} className="rounded-md p-1 text-muted hover:text-fg" aria-label="Cerrar asistente"><X className="h-4 w-4" /></button>
              </div>
              <div className="min-h-0 flex-1"><AssistantChat firstName={first} compact /></div>
            </div>
          )}
          <button onClick={() => setChatOpen((o) => !o)} aria-expanded={chatOpen}
            className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-violet-600 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-violet-600/30 transition hover:bg-violet-700 sm:bottom-6 sm:right-6">
            {chatOpen ? <X className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}<span className="hidden sm:inline">{chatOpen ? "Cerrar" : "Pregúntale al asistente"}</span>
            <span className="sr-only sm:hidden">Asistente</span>
          </button>
        </>
      )}
      <CommandPalette />
    </div>
  );
}
