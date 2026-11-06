"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home, PlusCircle, Inbox, LayoutGrid, BookOpen, CheckSquare, BarChart3, Users, UsersRound, Tags, Timer,
  ScrollText, Settings, Building2, Menu, X, LogOut, UserCircle, ListChecks, Sparkles, ChevronDown, Bug, GitPullRequestArrow, Network, CalendarDays, Workflow, Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui";
import { ThemeToggle } from "./theme-toggle";
import { NotificationBell } from "./notification-bell";
import { CommandPalette, SearchButton } from "./command-palette";
import { logoutAction } from "@/app/actions";
import { ExperienceSwitch } from "./experience-switch";

const ICONS = {
  home: Home, plus: PlusCircle, inbox: Inbox, grid: LayoutGrid, book: BookOpen, check: CheckSquare, chart: BarChart3,
  users: Users, teams: UsersRound, tags: Tags, timer: Timer, audit: ScrollText, settings: Settings, building: Building2,
  list: ListChecks, bug: Bug, change: GitPullRequestArrow, cmdb: Network, calendar: CalendarDays, workflow: Workflow, plug: Plug,
};
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; primary?: boolean };
export type NavSection = { title?: string; items: NavItem[] };

export function AppShell({ sections, user, canSwitch = false, children }: {
  sections: NavSection[];
  canSwitch?: boolean;
  user: { name: string; email: string; roleLabel: string; orgName: string | null };
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => { setMobileOpen(false); setMenuOpen(false); }, [pathname]);

  const isActive = (href: string) => href === "/home" ? pathname === "/home" : pathname === href || pathname.startsWith(href + "/");

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-fg"><Sparkles className="h-4 w-4" /></div>
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold">ITSM Easy</p>
          <p className="truncate text-[11px] text-muted">{user.orgName ?? "Plataforma SaaS"}</p>
        </div>
      </div>
      <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {sections.map((s, i) => (
          <div key={i}>
            {s.title && <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted">{s.title}</p>}
            <ul className="space-y-0.5">
              {s.items.map((it) => {
                const I = ICONS[it.icon];
                const active = isActive(it.href);
                return (
                  <li key={it.href}>
                    <Link href={it.href} aria-current={active ? "page" : undefined}
                      className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors",
                        it.primary ? "mb-2 bg-primary font-medium text-primary-fg hover:bg-primary-hover" :
                        active ? "bg-card font-medium text-fg shadow-sm ring-1 ring-border" : "text-muted hover:bg-card/60 hover:text-fg")}>
                      <I className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{it.label}</span>
                      {!!it.badge && <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", it.primary ? "bg-white/20" : "bg-primary-soft text-primary")}>{it.badge}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="relative border-t border-border p-3">
        {canSwitch && <ExperienceSwitch current="ops" className="mb-2 md:hidden" />}
        <button onClick={() => setMenuOpen((o) => !o)} className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-card" aria-expanded={menuOpen}>
          <Avatar name={user.name} size={30} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-[11px] text-muted">{user.roleLabel}</span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted" />
        </button>
        {menuOpen && (
          <div className="animate-in absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-xl">
            <p className="truncate px-3 py-2 text-xs text-muted">{user.email}</p>
            <Link href="/profile" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-subtle"><UserCircle className="h-4 w-4" />Mi perfil y seguridad</Link>
            <form action={logoutAction}>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-subtle"><LogOut className="h-4 w-4" />Cerrar sesión</button>
            </form>
          </div>
        )}
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-sidebar lg:block">{nav}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="animate-in absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-border bg-sidebar">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3.5 rounded-md p-1 text-muted" aria-label="Cerrar menú"><X className="h-5 w-5" /></button>
            {nav}
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-bg/80 px-4 backdrop-blur sm:px-6">
        <button onClick={() => setMobileOpen(true)} className="-ml-1 rounded-md p-1.5 text-muted lg:hidden" aria-label="Abrir menú"><Menu className="h-5 w-5" /></button>
        <SearchButton className="w-full max-w-xs" />
        <div className="flex-1" />
        {canSwitch && <ExperienceSwitch current="ops" className="hidden md:flex" />}
        <ThemeToggle />
        <NotificationBell />
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <CommandPalette />
    </div>
  );
}
