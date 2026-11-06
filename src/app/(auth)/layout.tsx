import { Sparkles, CheckCircle2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#111127] p-10 text-white lg:flex">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#5b5bd6]/40 blur-3xl" />
        <div className="absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-[#2f7dd6]/25 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10"><Sparkles className="h-4 w-4" /></div>
          <span className="font-semibold">ITSM Easy</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">La gestión de servicios TI, simplificada.</h1>
          <p className="mt-4 text-white/70">Pide ayuda en segundos, sigue tus solicitudes en tiempo real y deja que tu equipo de TI trabaje con prácticas ITIL 4 sin la complejidad.</p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            {["Solicitudes en menos de 30 segundos", "SLA, aprobaciones y escalamientos automáticos", "Un espacio seguro y aislado por empresa"].map((t) => (
              <li key={t} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#8b8bf0]" />{t}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} ITSM Easy</p>
      </div>
      <div className="relative flex items-center justify-center p-6">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
