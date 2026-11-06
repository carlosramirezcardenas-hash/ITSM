"use client";
import { useTransition } from "react";
import { Briefcase, Wrench } from "lucide-react";
import { setExperienceAction } from "@/app/actions";
import { cn } from "@/lib/utils";

/** Selector entre Portal del empleado y Operaciones TI (solo visible para el equipo de TI). */
export function ExperienceSwitch({ current, className }: { current: "employee" | "ops"; className?: string }) {
  const [pending, start] = useTransition();
  const opt = (mode: "employee" | "ops", label: string, short: string, Icon: typeof Briefcase) => (
    <button type="button" role="radio" aria-checked={current === mode} disabled={pending}
      onClick={() => current !== mode && start(() => setExperienceAction(mode))}
      className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition",
        current === mode ? "bg-card text-fg shadow-sm ring-1 ring-border" : "text-muted hover:text-fg", pending && "opacity-60")}>
      <Icon className="h-3.5 w-3.5" /><span className="hidden sm:inline">{label}</span><span className="sm:hidden">{short}</span>
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Experiencia" className={cn("flex items-center gap-0.5 rounded-lg bg-subtle p-0.5", className)}>
      {opt("employee", "Portal del empleado", "Portal", Briefcase)}
      {opt("ops", "Operaciones TI", "Operaciones", Wrench)}
    </div>
  );
}
