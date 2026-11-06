"use client";
import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Paleta categórica validada (slot 1 azul, slot 2 naranjo) con pasos para modo claro y oscuro.
const PALETTE = {
  light: { s1: "#2a78d6", s2: "#eb6834", grid: "#ececef", axis: "#6b6b76", surface: "#ffffff", good: "#16a34a", warn: "#d97706", bad: "#dc2626" },
  dark: { s1: "#3987e5", s2: "#d95926", grid: "#26262c", axis: "#9a9aa6", surface: "#141418", good: "#22c55e", warn: "#f59e0b", bad: "#ef4444" },
};

function usePalette() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark ? PALETTE.dark : PALETTE.light;
}

function TooltipBox({ active, payload, label, suffix = "" }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; suffix?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-fg tabular-nums">{p.value}{suffix}</span>
        </p>
      ))}
    </div>
  );
}

export function TrendChart({ data }: { data: { label: string; creados: number; resueltos: number }[] }) {
  const c = usePalette();
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded" style={{ background: c.s1 }} />Creados</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded" style={{ background: c.s2 }} />Resueltos</span>
      </div>
      <div className="h-56" role="img" aria-label="Tendencia de tickets creados y resueltos">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.s1} stopOpacity={0.18} /><stop offset="100%" stopColor={c.s1} stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: c.axis }} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: c.axis }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip content={<TooltipBox />} cursor={{ stroke: c.axis, strokeDasharray: "3 3" }} />
            <Area type="monotone" dataKey="creados" name="Creados" stroke={c.s1} strokeWidth={2} fill="url(#g1)" activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} animationDuration={500} />
            <Area type="monotone" dataKey="resueltos" name="Resueltos" stroke={c.s2} strokeWidth={2} fill="transparent" activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} animationDuration={500} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Barras horizontales de una sola serie (magnitud). */
export function HBarChart({ data, suffix = "", max, label }: { data: { name: string; value: number }[]; suffix?: string; max?: number; label: string }) {
  const c = usePalette();
  return (
    <div style={{ height: Math.max(120, data.length * 36) }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 0, bottom: 0 }} barCategoryGap={8}>
          <XAxis type="number" hide domain={[0, max ?? "auto"]} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: c.axis }} tickLine={false} axisLine={false} />
          <Tooltip content={<TooltipBox suffix={suffix} />} cursor={{ fill: c.grid, opacity: 0.5 }} />
          <Bar dataKey="value" name={label} fill={c.s1} radius={[0, 4, 4, 0]} maxBarSize={18} animationDuration={500}
            label={{ position: "right", fontSize: 11, fill: c.axis, formatter: (v: number) => `${v}${suffix}` }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cumplimiento: color de estado (bueno ≥ 90, atención ≥ 75, crítico < 75) + etiqueta visible. */
export function ComplianceChart({ data }: { data: { name: string; compliance: number | null; total: number }[] }) {
  const c = usePalette();
  const rows = data.map((d) => ({ name: d.name, value: d.compliance ?? 0, total: d.total }));
  return (
    <div style={{ height: Math.max(120, rows.length * 36) }} role="img" aria-label="Cumplimiento de SLA">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 44, left: 0, bottom: 0 }} barCategoryGap={8}>
          <XAxis type="number" hide domain={[0, 100]} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: c.axis }} tickLine={false} axisLine={false} />
          <Tooltip content={<TooltipBox suffix="%" />} cursor={{ fill: c.grid, opacity: 0.5 }} />
          <Bar dataKey="value" name="Cumplimiento" radius={[0, 4, 4, 0]} maxBarSize={18} animationDuration={500} label={{ position: "right", fontSize: 11, fill: c.axis, formatter: (v: number) => `${v}%` }}>
            {rows.map((r) => <Cell key={r.name} fill={r.value >= 90 ? c.good : r.value >= 75 ? c.warn : c.bad} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
