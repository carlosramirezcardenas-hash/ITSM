import Link from "next/link";
import { Clock, ShieldCheck } from "lucide-react";
import { DynIcon } from "./icon";
import { cn } from "@/lib/utils";

/** Portadas con color por categoría (estable por nombre) para el catálogo visual. */
const COVERS = [
  "from-indigo-500 to-violet-500",
  "from-sky-500 to-cyan-400",
  "from-emerald-500 to-teal-400",
  "from-amber-500 to-orange-400",
  "from-rose-500 to-pink-400",
  "from-fuchsia-500 to-purple-500",
  "from-blue-600 to-indigo-500",
  "from-lime-500 to-emerald-500",
];
/** Color de portada de una categoría según su posición en la lista ordenada de categorías de la organización. */
export function coverFor(key: string | null | undefined, order: string[] = []) {
  const k = key ?? "";
  const i = order.indexOf(k);
  if (i >= 0) return COVERS[i % COVERS.length]!;
  let h = 0;
  for (let j = 0; j < k.length; j++) h = (h * 31 + k.charCodeAt(j)) >>> 0;
  return COVERS[h % COVERS.length]!;
}

export const eta = (h: number) => (h < 24 ? `${h} h` : `${Math.round(h / 24)} día${Math.round(h / 24) > 1 ? "s" : ""}`);

export type Tile = { id: string; name: string; description: string; icon: string; estimatedHours: number; requiresApproval: boolean; category: { name: string } | null };

export function ServiceTile({ s, className, badge, order }: { s: Tile; className?: string; badge?: string; order?: string[] }) {
  return (
    <Link href={`/catalog/${s.id}`}
      className={cn("group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring", className)}>
      <div className={cn("relative flex h-28 items-center justify-center bg-gradient-to-br text-white", coverFor(s.category?.name, order))}>
        <DynIcon name={s.icon} className="h-10 w-10 drop-shadow transition duration-300 group-hover:scale-110" />
        {badge && <span className="absolute left-2.5 top-2.5 rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur">{badge}</span>}
        {s.category && <span className="absolute bottom-2 right-2.5 text-[11px] font-medium text-white/85">{s.category.name}</span>}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="font-medium leading-snug">{s.name}</p>
        <p className="mt-1 line-clamp-2 flex-1 text-xs text-muted">{s.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />~{eta(s.estimatedHours)}</span>
          {s.requiresApproval && <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />Requiere aprobación</span>}
        </div>
      </div>
    </Link>
  );
}
