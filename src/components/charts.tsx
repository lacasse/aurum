"use client";

import { useId } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "./ui";

export const PALETTE = [
  "#8b5cf6",
  "#22d3ee",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#60a5fa",
  "#a3e635",
  "#fb7185",
];

const GRID_PROPS = {
  stroke: "var(--line)",
  strokeDasharray: "3 3",
  vertical: false,
} as const;

const AXIS_TICK = {
  fill: "var(--ink-faint)",
  fontSize: 11,
} as const;

const LEGEND_STYLE = {
  fontSize: 12,
  color: "var(--ink-dim)",
} as const;

type TooltipItem = {
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
};

export function ChartTooltip({
  active,
  payload,
  label,
  fmt,
  title,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  fmt?: (n: number) => string;
  title?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-xl">
      {title !== undefined ? (
        <p className="mb-1 text-[11px] font-medium text-ink-faint">{title}</p>
      ) : label !== undefined && label !== "" ? (
        <p className="mb-1 text-[11px] font-medium text-ink-faint">{label}</p>
      ) : null}
      <div className="space-y-0.5">
        {payload.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: item.color ?? "var(--brand)" }}
            />
            <span className="text-ink-dim">{item.name}</span>
            <span className="ml-auto font-medium tabular-nums text-ink">
              {fmt ? fmt(Number(item.value)) : String(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Sparkline ---------------- */

export function Sparkline({
  data,
  dataKey,
  color = "var(--brand-strong)",
  height = 40,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  color?: string;
  height?: number;
}) {
  const gid = useId().replace(/[:]/g, "");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#spark-${gid})`}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ---------------- Area / Line trend ---------------- */

export interface SeriesDef {
  key: string;
  name: string;
  color: string;
  kind?: "area" | "line";
  dashed?: boolean;
}

export function SeriesChart({
  data,
  xKey,
  series,
  height = 280,
  yFmt,
  xFmt,
  stacked = false,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
  yFmt?: (n: number) => string;
  xFmt?: (n: number) => string;
  stacked?: boolean;
}) {
  const gid = useId().replace(/[:]/g, "");
  const stackId = stacked ? "1" : undefined;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis
          dataKey={xKey}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => (xFmt ? xFmt(Number(v)) : String(v))}
          minTickGap={24}
        />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v) => (yFmt ? yFmt(Number(v)) : String(v))}
        />
        <Tooltip
          cursor={{ stroke: "var(--ink-faint)", strokeDasharray: "4 4" }}
          content={<ChartTooltip fmt={yFmt} />}
        />
        {series.map((s, i) =>
          s.kind === "line" ? (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 5" : undefined}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ) : (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#${gid}-${i})`}
              stackId={stackId}
              activeDot={{ r: 3 }}
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ---------------- Grouped bars ---------------- */

export function GroupedBars({
  data,
  xKey,
  bars,
  height = 280,
  yFmt,
  stacked,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  bars: SeriesDef[];
  height?: number;
  yFmt?: (n: number) => string;
  stacked?: boolean;
}) {
  const stackId = stacked ? "a" : undefined;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v) => (yFmt ? yFmt(Number(v)) : String(v))}
        />
        <Tooltip
          cursor={{ fill: "var(--elevated)", opacity: 0.6 }}
          content={<ChartTooltip fmt={yFmt} />}
        />
        {bars.length > 1 ? (
          <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={8} />
        ) : null}
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.name}
            fill={b.color}
            radius={[4, 4, 0, 0]}
            maxBarSize={26}
            stackId={stackId}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ---------------- Donut ---------------- */

export function DonutChart({
  data,
  height = 260,
  centerLabel,
  centerValue,
  fmt,
}: {
  data: { name: string; value: number }[];
  height?: number;
  centerLabel?: string;
  centerValue?: string;
  fmt?: (n: number) => string;
}) {
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip fmt={fmt} />} />
        </PieChart>
      </ResponsiveContainer>
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-1">
          <span className="text-[11px] text-ink-faint">{centerLabel}</span>
          <span className="text-lg font-semibold tabular-nums">{centerValue}</span>
        </div>
      ) : null}
      <ul className="mt-2 space-y-1.5 px-1">
        {data.slice(0, 7).map((d, i) => (
          <li key={d.name} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: PALETTE[i % PALETTE.length] }}
            />
            <span className="truncate text-ink-dim">{d.name}</span>
            <span className="ml-auto font-medium tabular-nums text-ink">
              {fmt ? fmt(d.value) : d.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Horizontal bars (signed) ---------------- */

export function SignedHBars({
  data,
  labelKey,
  valueKey,
  height = 300,
  fmt,
  positiveColor = "#34d399",
  negativeColor = "#fb7185",
}: {
  data: Record<string, unknown>[];
  labelKey: string;
  valueKey: string;
  height?: number;
  fmt?: (n: number) => string;
  positiveColor?: string;
  negativeColor?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
      >
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => (fmt ? fmt(Number(v)) : String(v))}
        />
        <YAxis
          type="category"
          dataKey={labelKey}
          tick={{ ...AXIS_TICK, fill: "var(--ink-dim)" }}
          tickLine={false}
          axisLine={false}
          width={86}
        />
        <Tooltip
          cursor={{ fill: "var(--elevated)", opacity: 0.6 }}
          content={<ChartTooltip fmt={fmt} />}
        />
        <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} maxBarSize={18}>
          {data.map((row, i) => (
            <Cell
              key={i}
              fill={Number(row[valueKey]) >= 0 ? positiveColor : negativeColor}
            />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ---------------- Budget vs actual grouped bars ---------------- */

export function BudgetVsActual({
  data,
  height = 300,
  fmt,
}: {
  data: { category: string; budgeted: number; spent: number }[];
  height?: number;
  fmt?: (n: number) => string;
}) {
  return (
    <GroupedBars
      data={data as unknown as Record<string, unknown>[]}
      xKey="category"
      bars={[
        { key: "budgeted", name: "Budgeted", color: "#3f3f50" },
        { key: "spent", name: "Spent", color: "#8b5cf6" },
      ]}
      height={height}
      yFmt={fmt}
    />
  );
}

/* ---------------- Radial gauge ---------------- */

export function RadialGauge({
  pct,
  label,
  sublabel,
  height = 200,
}: {
  pct: number;
  label: string;
  sublabel?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = pct >= 100 ? "#fb7185" : pct >= 80 ? "#f59e0b" : "#34d399";
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart
          data={[{ v: clamped }]}
          cx="50%"
          cy="50%"
          outerRadius="92%"
          innerRadius="72%"
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <PolarGrid gridType="circle" stroke="var(--line)" radialLines={false} />
          <Radar dataKey="v" stroke={color} fill={color} fillOpacity={0.35} isAnimationActive={false} />
          <PolarRadiusAxis tick={false} axisLine={false} />
        </RadarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-2">
        <span className="text-2xl font-semibold tabular-nums" style={{ color }}>
          {Math.round(pct)}%
        </span>
        <span className="text-xs text-ink-dim">{label}</span>
        {sublabel ? <span className="text-[11px] text-ink-faint">{sublabel}</span> : null}
      </div>
    </div>
  );
}

/* ---------------- Sector radar ---------------- */

export function SectorRadar({
  data,
  height = 260,
  fmt,
}: {
  data: { sector: string; value: number }[];
  height?: number;
  fmt?: (n: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="72%">
        <PolarGrid stroke="var(--line)" />
        <PolarAngleAxis
          dataKey="sector"
          tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
        />
        <PolarRadiusAxis tick={false} axisLine={false} />
        <Radar
          name="Exposure"
          dataKey="value"
          stroke="#22d3ee"
          fill="#22d3ee"
          fillOpacity={0.25}
        />
        <Tooltip content={<ChartTooltip fmt={fmt} />} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function ChartLegend({
  items,
}: {
  items: { label: string; color: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-xs text-ink-dim">
          <span className={cn("h-2 w-2 rounded-full")} style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
