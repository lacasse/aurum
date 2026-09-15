"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Layer,
  Legend,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  Rectangle,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Sankey,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, cn } from "./ui";
import { fmtPct, fmtSignedCAD } from "@/lib/format";
import { accent, spectrumAt, type AccentName } from "@/lib/palette";
import type { NetWorthClass } from "@/lib/analytics";
import { columnsOf, layoutFlow } from "@/lib/flow-layout";

export { spectrumAt } from "@/lib/palette";

/**
 * One colour per class of thing owned, and the order they stack in.
 *
 * Shared because the same composition is drawn on two pages now — month by
 * month on the dashboard and year by year on the Year page — and a band that
 * is amber in one and blue in the other is two charts the reader has to learn
 * separately rather than one they can read twice.
 *
 * The order is a decision about a picture, not about the domain, which is why
 * it lives here and not beside `NET_WORTH_CLASSES`. Whatever sits last is the
 * top of the stack, and the top of a stack that always totals a hundred
 * percent runs along the frame, where its boundary line cannot be seen. That
 * costs crypto nothing — it is unmistakable from its fill — and it cost the
 * pension its line entirely while it sat up there.
 */
export const CLASS_COLORS: Record<NetWorthClass, string> = {
  Cash: "#34d399",
  Bonds: "#60a5fa",
  Pension: "#f472b6",
  Stocks: "#f59e0b",
  Crypto: "#8b5cf6",
};

export const BAND_ORDER: NetWorthClass[] = [
  "Cash",
  "Bonds",
  "Pension",
  "Stocks",
  "Crypto",
];

/**
 * One colour per category, assigned in the order given.
 *
 * Shared so that a category is the same colour wherever it is drawn: the
 * average-month donut and the stacked trend beside it are the same spending
 * seen two ways, and reading them together means matching Housing to Housing
 * by eye. Pass the categories in one ranking and both charts agree.
 *
 * Drawn from the same spectrum as the holdings exposure ring, so every ring in
 * the app is one palette rather than a categorical set here and a spectrum
 * there. Spread across however many categories there are, which is what keeps
 * a five-slice donut from using five colours out of one corner of it.
 */
export function categoryColors(names: readonly string[]): Record<string, string> {
  const unique = [...new Set(names)];
  const out: Record<string, string> = {};
  unique.forEach((name, i) => {
    out[name] = spectrumAt(i, unique.length);
  });
  return out;
}

const GRID_PROPS = {
  stroke: "var(--line)",
  strokeDasharray: "3 3",
  vertical: false,
} as const;

/*
 * Chart text is drawn into the SVG, where a rem means nothing, so these two
 * are the one place a size is still stated in pixels. Kept a notch under the
 * body scale — an axis label is a reference, not something to read.
 */
const AXIS_TICK = {
  fill: "var(--ink-faint)",
  fontSize: 12,
} as const;

const LEGEND_STYLE = {
  fontSize: 13,
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
        <p className="mb-1 text-[0.6875rem] font-medium text-ink-faint">{title}</p>
      ) : label !== undefined && label !== "" ? (
        <p className="mb-1 text-[0.6875rem] font-medium text-ink-faint">{label}</p>
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
  color,
  height = 40,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  color?: string;
  height?: number;
}) {
  const stroke = color ?? accent("brand");
  const gid = useId().replace(/[:]/g, "");
  /*
   * Fit the line to its own range rather than to zero.
   *
   * Without an axis Recharts anchors the bottom at nothing, so a balance that
   * moved by a few per cent was drawn as a flat line four fifths of the way up
   * the box — the movement, which is the only thing a sparkline is for, was a
   * rounding error against the distance to zero. A tenth of the range is
   * left as headroom so the peaks are not clipped to the edges, and a series
   * that never moves still draws a line through the middle rather than
   * dividing by nothing.
   */
  const values = data
    .map((d) => Number(d[dataKey]))
    .filter((v) => Number.isFinite(v));
  const low = values.length > 0 ? Math.min(...values) : 0;
  const high = values.length > 0 ? Math.max(...values) : 0;
  const pad = high === low ? Math.abs(high) * 0.1 || 1 : (high - low) * 0.1;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <YAxis hide domain={[low - pad, high + pad]} />
        <defs>
          <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={stroke}
          strokeWidth={1.5}
          fill={`url(#spark-${gid})`}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * How present a series is at each point, eased so it arrives and leaves over a
 * few points rather than one.
 *
 * Starts as one where the value is something and zero where it is not, then
 * two passes of a three-point mean round the corners off. Two passes is what
 * spreads the transition across roughly three points; a single pass ramps over
 * one, which still reads as a cut.
 */
function presenceRamp(data: Record<string, unknown>[], key: string): number[] {
  const present = data.map((d) => (Number(d[key]) > 0 ? 1 : 0));
  const smooth = (xs: number[]) =>
    xs.map((_, i) => {
      const window = [xs[i - 1], xs[i], xs[i + 1]].filter(
        (v): v is number => v !== undefined,
      );
      return window.reduce((sum, v) => sum + v, 0) / window.length;
    });
  return smooth(smooth(present));
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
  yDomain,
  fadeAtZero = false,
  strokeOnly = false,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  /**
   * A number of pixels, or a percentage of the box this sits in — which is how
   * a chart in a card beside a taller card grows to meet it rather than
   * leaving the bottom of its card empty.
   */
  height?: number | `${number}%`;
  yFmt?: (n: number) => string;
  xFmt?: (n: number) => string;
  stacked?: boolean;
  /**
   * Fixes the axis instead of fitting it to the data.
   *
   * Recharts pads its domain above the largest value, which is right for a
   * chart of money and wrong for one of shares: a stack that always totals a
   * hundred percent was given an axis running to 120, leaving a fifth of the
   * plot as blank space above a ceiling nothing can cross.
   */
  yDomain?: [number, number];
  /**
   * Fades each line out over the stretches where its series is nothing.
   *
   * A band held in none of a month still has a position in a stack — the same
   * one as the top of the band below it — so its line runs flat along its
   * neighbour's edge for years it did not exist. Cutting the line at the first
   * zero fixes that but reads as a glitch, a line that simply stops. Fading it
   * says the same thing the way the eye expects: the holding tails off, and
   * comes back when it comes back.
   */
  fadeAtZero?: boolean;
  /**
   * Draws a stack as lines with nothing under them.
   *
   * Recharts stacks areas, not lines — a `Line` ignores `stackId` — so a
   * stacked line chart is an area chart with the fill taken away. The strokes
   * are still cumulative, which is what stacking means, and the reader takes
   * each band as the distance to the line below rather than as a filled
   * region.
   */
  strokeOnly?: boolean;
}) {
  const gid = useId().replace(/[:]/g, "");
  const stackId = stacked ? "1" : undefined;
  /*
   * A ramp per series, but only where it has something to say.
   *
   * The fade is drawn as a gradient in objectBoundingBox units, and SVG does
   * not render one of those on a path whose bounding box has no height. The
   * top band of a share chart is exactly that path: a series that is every
   * year the whole of the stack draws a dead-flat line along the ceiling, so
   * its stroke was dropped entirely and the band the reader was being asked to
   * follow was the one line on the chart that did not exist. The gradient in
   * that case was a no-op anyway — every stop opaque, because the series is
   * never absent — so it was destroying the line in exchange for nothing.
   *
   * Null means paint the colour straight on, which is both correct and what a
   * series that never disappears wants.
   */
  const fades = series.map((s) => {
    if (!fadeAtZero) return null;
    const ramp = presenceRamp(data, s.key);
    return ramp.some((o) => o < 1) ? ramp : null;
  });
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
          {/*
            * A gradient along the x-axis rather than down it: one stop per
            * point, opaque where the series has something and clear where it
            * has nothing, so the stroke dissolves across the months either
            * side instead of stopping dead at one of them.
            */}
          {series.map((s, i) =>
            fades[i] === null ? null : (
              <linearGradient
                key={`fade-${s.key}`}
                id={`fade-${gid}-${i}`}
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                {fades[i]!.map((op, j, all) => (
                  <stop
                    key={j}
                    offset={`${all.length > 1 ? (j / (all.length - 1)) * 100 : 0}%`}
                    stopColor={s.color}
                    stopOpacity={op}
                  />
                ))}
              </linearGradient>
            ),
          )}
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
          domain={yDomain}
          /*
           * Without this the axis quietly widens to fit the data and the
           * domain is decoration: a chart asking for nought to ten, drawn over
           * a stack totalling a hundred, got an axis of a hundred and a single
           * surviving tick.
           */
          allowDataOverflow={yDomain !== undefined}
          /*
           * Ticks across whatever the domain is, not the quarters of a hundred
           * this was written for. Hardcoding them meant a chart given a domain
           * of nought to ten was labelled nought to a hundred — the axis
           * silently disagreeing with the data drawn against it, which is the
           * worst way for a chart to be wrong.
           */
          ticks={
            yDomain
              ? Array.from(
                  { length: 5 },
                  (_, i) =>
                    Math.round((yDomain[0] + ((yDomain[1] - yDomain[0]) * i) / 4) * 100) / 100,
                )
              : undefined
          }
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
              stroke={fades[i] ? `url(#fade-${gid}-${i})` : s.color}
              strokeWidth={2}
              fill={strokeOnly ? "none" : `url(#${gid}-${i})`}
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
  /** A percentage fills whatever box the card gives it. See SeriesChart. */
  height?: number | `${number}%`;
  yFmt?: (n: number) => string;
  stacked?: boolean;
}) {
  const stackId = stacked ? "a" : undefined;
  /*
   * Only the top of a stack is rounded. Every bar carried the same rounded
   * corners, so a stacked column read as a pile of separate capsules with a
   * curve cutting into the segment above each one. Side-by-side bars all get
   * it, since each of those is its own column with its own top.
   *
   * "Top" is the last series, not whichever segment happens to be the highest
   * that month: a series that is zero in one month leaves the corners on a
   * band nobody can see, which is invisible rather than wrong.
   */
  const last = bars.length - 1;
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
        {bars.map((b, i) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.name}
            fill={b.color}
            radius={!stacked || i === last ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            maxBarSize={26}
            stackId={stackId}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ---------------- Donut ---------------- */

/*
 * Every ring in the app starts at the top and fills clockwise, which is how a
 * clock face and every pie anybody has read work. Recharts starts at three
 * o'clock and runs anticlockwise unless told otherwise, so the largest slice
 * used to begin on the right-hand edge and grow the wrong way.
 */
const PIE_START = 90;
const PIE_END = -270;

/** Largest first, so the ring reads down from the biggest share. */
function byValueDesc<T extends { value: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.value - a.value);
}

/** Grouped by class, largest class first, largest first inside each. */
function byClassThenValue<T extends { value: number; assetClass: string }>(rows: T[]): T[] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.assetClass, (totals.get(r.assetClass) ?? 0) + r.value);
  return [...rows].sort((a, b) => {
    if (a.assetClass !== b.assetClass) {
      const diff = (totals.get(b.assetClass) ?? 0) - (totals.get(a.assetClass) ?? 0);
      return diff !== 0 ? diff : a.assetClass.localeCompare(b.assetClass);
    }
    return b.value - a.value;
  });
}

export function DonutChart({
  data,
  height = 260,
  centerLabel,
  centerValue,
  fmt,
  colors,
  legend = "below",
}: {
  data: { name: string; value: number }[];
  height?: number;
  centerLabel?: string;
  centerValue?: string;
  fmt?: (n: number) => string;
  /** Colour per category name. Falls back to the palette in slice order. */
  colors?: Record<string, string>;
  /**
   * Where the key goes.
   *
   * "below" stacks it under the ring, which is what a narrow card wants. On a
   * wide one that leaves the ring floating in a column of its own with white
   * space either side, so "left" and "right" set the two beside each other and
   * let the pair fill the width.
   */
  legend?: "below" | "left" | "right";
}) {
  /*
   * Sorted here rather than trusted from the caller: the colour map is keyed
   * by name, so ordering the ring cannot repaint anything.
   */
  const rows = byValueDesc(data);
  /* The exposure ring's spectrum, spread across the slices there are. */
  const colorOf = (name: string, i: number) =>
    colors?.[name] ?? spectrumAt(i, rows.length);
  const beside = legend !== "below";
  return (
    <div
      className={cn(
        beside && "flex flex-col gap-4 sm:flex-row sm:items-center",
        legend === "left" && "sm:flex-row-reverse",
      )}
    >
      <div className={cn("relative", beside && "min-w-0 flex-1")}>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              startAngle={PIE_START}
              endAngle={PIE_END}
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {rows.map((d, i) => (
                <Cell key={i} fill={colorOf(d.name, i)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip fmt={fmt} />} />
          </PieChart>
        </ResponsiveContainer>
        {centerValue ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[0.6875rem] text-ink-faint">{centerLabel}</span>
            <span className="text-lg font-semibold tabular-nums">{centerValue}</span>
          </div>
        ) : null}
      </div>
      <ul
        className={cn(
          "space-y-1.5 px-1",
          beside ? "min-w-0 flex-1" : "mt-2",
        )}
      >
        {rows.slice(0, 7).map((d, i) => (
          <li key={d.name} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: colorOf(d.name, i) }}
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

/* ---------------- Holdings exposure ---------------- */

/*
 * The spectrum every holding is coloured from lives in `@/lib/palette`, which
 * is what the colour-picking page edits. Why this particular ramp:
 *
 * Thirteen anchors, sampled to however many positions there are. It replaced
 * one hue per asset class with a ramp of shades inside it, which sounded
 * tidier than it looked: a class with seven holdings had to fit seven
 * distinguishable shades of one hue into the range both themes can show, and
 * the small ones ended up as near-identical slivers of the same colour.
 *
 * It ends at violet rather than carrying on to blue. A spectrum whose two ends
 * are both cool does not read as a sweep when there are only a handful of
 * slices: four categories came out navy, green, red, blue, which looks like a
 * set that doubled back rather than a rainbow. Ending one step early, the same
 * four are navy, green, orange, violet.
 *
 * Colour now says which holding, and nothing else — the class is a tag in the
 * legend beside it. The honest trade is that neighbouring steps of any
 * spectrum are close: this one's worst adjacent pair measures ΔE 8.2 with full
 * colour vision and 0.6 under simulated protanopia, so colour alone does not
 * identify a slice. That is what the legend and the tooltip are for, and why
 * both name every position.
 */

export type ExposureDatum = {
  ticker: string;
  name: string;
  assetClass: string;
  value: number;
};

/**
 * What the key can say about each position beyond its size, keyed by ticker.
 * Given, the key becomes the holdings list itself: name, class, value, what
 * the position made and how fast, and its share of the ring.
 */
export type ExposureDetail = {
  /** Everything the position made, in dollars. */
  gain: number;
  /** Annualized money-weighted return, or null with no trade history. */
  mwrr: number | null;
  /** The price could not be refreshed today. */
  stale?: boolean;
};

export function ExposurePie({
  data,
  height = 300,
  fmt,
  legend = "below",
  details,
  order = "value",
}: {
  data: ExposureDatum[];
  height?: number;
  fmt?: (n: number) => string;
  /**
   * Where the key goes.
   *
   * "below" stacks it under the ring. Across a full-width card that leaves the
   * ring adrift in the middle with the rows running the whole width beneath
   * it, so "right" puts the two side by side — the ring at a readable size and
   * the key filling what is left, which is what a long list of positions
   * wants.
   */
  legend?: "below" | "right";
  details?: Record<string, ExposureDetail>;
  /**
   * "value" runs the ring largest position first. "class" groups it by asset
   * class, the largest class first and the largest position first inside each,
   * so a class's slices sit together and its share reads as one arc.
   */
  order?: "value" | "class";
}) {
  /*
   * Classes folded away by clicking their heading. Only the key with the
   * holdings list offers this, and it keeps the state here because the ring
   * and the list have to agree about what is being shown.
   */
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggleClass = (assetClass: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(assetClass)) next.delete(assetClass);
      // Never fold the last one away: a ring of nothing answers no question.
      else if (data.some((d) => d.assetClass !== assetClass && !next.has(d.assetClass))) {
        next.add(assetClass);
      }
      return next;
    });

  /*
   * One step of the spectrum per holding, in the order they arrive — which is
   * largest first. Colour is position in the ring, not asset class: the class
   * is a tag on the legend row instead, which says the same thing without
   * spending a whole hue family on a class that holds two positions.
   */
  const colored = useMemo(
    () =>
      (order === "class" ? byClassThenValue(data) : byValueDesc(data)).map((d, i) => ({
        ...d,
        color: spectrumAt(i, data.length),
      })),
    [data, order],
  );

  /*
   * What the ring draws, and what every percentage is measured against. A
   * colour is a position's own, taken from the full list, so folding a class
   * away does not recolour everything that stays.
   */
  const shown = details ? colored.filter((d) => !hidden.has(d.assetClass)) : colored;
  const total = shown.reduce((sum, d) => sum + d.value, 0);

  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—");

  const beside = legend === "right";
  return (
    <div className={cn(beside && "flex flex-col gap-5 lg:flex-row lg:items-center")}>
      {/* With the list as its key, the ring gives up width to the names. */}
      <div className={cn(beside && (details ? "lg:w-[30%] lg:shrink-0" : "lg:w-2/5 lg:shrink-0"))}>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={shown}
              dataKey="value"
              nameKey="ticker"
              startAngle={PIE_START}
              endAngle={PIE_END}
              innerRadius="48%"
              outerRadius="86%"
              paddingAngle={1}
              stroke="var(--surface)"
              strokeWidth={1}
            >
              {shown.map((d) => (
                <Cell key={d.ticker} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              content={<ChartTooltip fmt={(n) => `${fmt ? fmt(n) : n} · ${pct(n)}`} />}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {details ? (
        <HoldingsKey
          rows={colored}
          details={details}
          fmt={fmt}
          pct={pct}
          beside={beside}
          hidden={hidden}
          onToggleClass={toggleClass}
          onShowAll={() => setHidden(new Set())}
        />
      ) : (
      /*
        One row per holding, because that is now what a colour means. It used
        to be one row per asset class with the holdings inside it as a bar; the
        classes are still here, as a tag, but they no longer decide the colour
        and so cannot organise the key.
      */
      <div className={cn("space-y-px px-1", beside ? "min-w-0 flex-1" : "mt-3")}>
        {colored.map((r) => (
          <div
            key={r.ticker}
            className="flex items-center gap-2 text-xs leading-6"
            title={r.name}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: r.color }}
            />
            <span className="shrink-0 font-medium text-ink">{r.ticker}</span>
            {/*
              * The name takes the slack rather than the numbers being pushed
              * to the far edge by it. With `ml-auto` on the tag, a short name
              * like "Bitcoin" left a band of nothing between the label and the
              * figures it belongs to; growing the name closes that gap while
              * the columns stay ranged right and aligned down the list.
              */}
            <span className="min-w-0 flex-1 truncate text-ink-faint">{r.name}</span>
            <span className="shrink-0 rounded bg-elevated px-1.5 py-px text-[0.625rem] text-ink-faint">
              {r.assetClass}
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums text-ink-dim">
              {fmt ? fmt(r.value) : r.value}
            </span>
            <span className="w-12 shrink-0 text-right font-medium tabular-nums text-ink">
              {pct(r.value)}
            </span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

/*
 * The key as the holdings list.
 *
 * The ring's colour is the row's identity, so the dot leads; the ticker is
 * dropped because the name says the same thing to a person and the colour
 * already ties the row to its slice. What follows is how the position has
 * done — value, gain, return — and its share of the ring last, where the key
 * always put it. The class heads each run of rows instead of taking a column.
 */
const KEY_COLUMNS = "sm:grid-cols-[0.625rem_minmax(0,1fr)_4.75rem_4.75rem_4.5rem]";

function HoldingsKey({
  rows,
  details,
  fmt,
  pct,
  beside,
  hidden,
  onToggleClass,
  onShowAll,
}: {
  rows: (ExposureDatum & { color: string })[];
  details: Record<string, ExposureDetail>;
  fmt?: (n: number) => string;
  pct: (v: number) => string;
  beside: boolean;
  hidden: Set<string>;
  onToggleClass: (assetClass: string) => void;
  onShowAll: () => void;
}) {
  /*
   * Runs of one class, in the order the ring draws them. The class is a
   * heading over its run rather than a column on every row: the list is
   * grouped by class already, so a column repeated the same word down each
   * group and took width the names needed.
   */
  const groups: { assetClass: string; rows: typeof rows; value: number }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.assetClass === r.assetClass) {
      last.rows.push(r);
      last.value += r.value;
    } else {
      groups.push({ assetClass: r.assetClass, rows: [r], value: r.value });
    }
  }

  return (
    <div className={cn("min-w-0", beside ? "flex-1" : "mt-4")} role="table" aria-label="Holdings">
      <div
        role="row"
        className={cn(
          KEY_COLUMNS,
          "hidden items-end gap-x-3 border-b border-line px-3 pb-1.5 text-[0.625rem] font-medium uppercase tracking-wider text-ink-faint sm:grid",
        )}
      >
        <span />
        <span role="columnheader">Asset</span>
        <span role="columnheader" className="text-right">Value</span>
        <span
          role="columnheader"
          className="text-right"
          title="Everything the position has made: its unrealized gain, any realized gain from sales, and the dividends it paid"
        >
          Gain
        </span>
        <span
          role="columnheader"
          className="text-right"
          title="Money-weighted return, annualized — the rate your own money grew at, with the timing of every purchase and sale taken into account"
        >
          Return / yr
        </span>
      </div>
      {hidden.size > 0 && (
        <div className="flex justify-end px-3 pt-2">
          <button
            type="button"
            onClick={onShowAll}
            className="rounded-md px-1.5 py-0.5 text-[0.625rem] font-medium text-brand hover:bg-elevated"
          >
            Show all classes
          </button>
        </div>
      )}

      {groups.map((g) => {
        const folded = hidden.has(g.assetClass);
        return (
        <div key={g.assetClass} role="rowgroup" className="pt-2 first:pt-1.5">
          {/*
            * The heading is the control: clicking a class folds it away and
            * takes it out of the ring, and every percentage is then measured
            * against what is left — fold everything but one class and that
            * class reads 100%, with each holding's share of it beside its name.
            *
            * The chevron says so without a legend, and the whole heading is the
            * hit area rather than the chevron alone.
            */}
          <button
            type="button"
            onClick={() => onToggleClass(g.assetClass)}
            aria-expanded={!folded}
            className={cn(
              "group flex w-full items-baseline gap-2 rounded-md px-3 py-0.5 text-left transition-colors hover:bg-elevated/60",
              folded && "opacity-60 hover:opacity-100",
            )}
          >
            <ChevronDown
              size={11}
              className={cn(
                "shrink-0 self-center text-ink-faint transition-transform",
                folded && "-rotate-90",
              )}
              aria-hidden
            />
            <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-ink-dim group-hover:text-ink">
              {g.assetClass}
            </span>
            <span className="text-[0.625rem] tabular-nums text-ink-faint">
              {folded ? `${g.rows.length} hidden` : pct(g.value)}
            </span>
          </button>
          <ul hidden={folded}>
            {g.rows.map((r) => {
              const d = details[r.ticker];
              const gainTone = d && d.gain >= 0 ? "text-positive" : "text-negative";
              const ret =
                d?.mwrr === null || d?.mwrr === undefined ? (
                  <span
                    className="text-ink-faint"
                    title="No trade history for this position — import trades or log them to measure a return"
                  >
                    —
                  </span>
                ) : (
                  <Badge tone={d.mwrr >= 0 ? "positive" : "negative"}>
                    <span className="tabular-nums">{fmtPct(d.mwrr)}</span>
                  </Badge>
                );
              return (
                <li
                  key={r.ticker}
                  role="row"
                  className={cn(
                    KEY_COLUMNS,
                    "grid grid-cols-[0.625rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-md px-3 py-1 transition-colors hover:bg-elevated/60",
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: r.color }}
                    aria-hidden
                  />
                  <div role="cell" className="min-w-0">
                    {/*
                      * The share sits with the name rather than in a column of
                      * its own: it says how big this position is, which is part
                      * of what the position is, and the numbers to the right are
                      * all about how it has done.
                      */}
                    <p className="flex items-baseline gap-2">
                      <span
                        className="truncate text-[0.8125rem] font-semibold leading-snug text-ink"
                        title={r.name}
                      >
                        {r.name || r.ticker}
                      </span>
                      <span className="shrink-0 text-[0.6875rem] tabular-nums text-ink-faint">
                        {pct(r.value)}
                      </span>
                    </p>
                    {/* On a phone the gain and return ride under the name. */}
                    {d && (
                      <p className="mt-1 flex items-center gap-2 text-[0.6875rem] sm:hidden">
                        <span className={cn("font-medium tabular-nums", gainTone)}>
                          {fmtSignedCAD(d.gain)}
                        </span>
                        {ret}
                      </p>
                    )}
                  </div>
                  <div role="cell" className="text-right">
                    <span className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold tabular-nums text-ink">
                      {d?.stale && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-400"
                          title="Last known price — today's price could not be fetched yet"
                          aria-label="Price not updated today"
                        />
                      )}
                      {fmt ? fmt(r.value) : r.value}
                    </span>
                  </div>
                  <div
                    role="cell"
                    className={cn(
                      "hidden text-right text-[0.8125rem] font-medium tabular-nums sm:block",
                      gainTone,
                    )}
                  >
                    {d ? fmtSignedCAD(d.gain) : "—"}
                  </div>
                  <div role="cell" className="hidden text-right sm:block">
                    {ret}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        );
      })}
    </div>
  );
}

/* ---------------- Time-weighted return comparison ---------------- */

export function TwrChart({
  data,
  height = 300,
  benchmarkName = "Benchmark",
}: {
  data: Record<string, unknown>[];
  height?: number;
  benchmarkName?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
        />
        <Tooltip
          cursor={{ stroke: "var(--ink-faint)", strokeDasharray: "4 4" }}
          content={<ChartTooltip fmt={(n) => `${n.toFixed(1)}%`} />}
        />
        <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={8} />
        <ReferenceLine y={0} stroke="var(--ink-faint)" strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="portfolio"
          name="Portfolio"
          stroke={accent("market")}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="benchmark"
          name={benchmarkName}
          stroke={accent("cost")}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ---------------- Horizontal bars (signed) ---------------- */

export function SignedHBars({
  data,
  labelKey,
  valueKey,
  height = 300,
  fmt,
  positiveColor,
  negativeColor,
}: {
  data: Record<string, unknown>[];
  labelKey: string;
  valueKey: string;
  /**
   * A number of pixels, or a percentage of the box this sits in — which is how
   * a chart in a card beside a taller card grows to meet it rather than
   * leaving the bottom of its card empty.
   */
  height?: number | `${number}%`;
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
              fill={
              Number(row[valueKey]) >= 0
                ? (positiveColor ?? accent("positive"))
                : (negativeColor ?? accent("negative"))
            }
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
        { key: "spent", name: "Spent", color: accent("brand") },
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
  const color =
    pct >= 100 ? accent("negative") : pct >= 80 ? accent("cost") : accent("positive");
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
        {sublabel ? <span className="text-[0.6875rem] text-ink-faint">{sublabel}</span> : null}
      </div>
    </div>
  );
}

/* ---------------- Sector radar ---------------- */

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

/* ---------------- Contribution room gauge ---------------- */

/**
 * A ring showing how much of a year's contribution room has been used.
 *
 * Drawn by hand rather than with a chart library. A gauge is one arc and a
 * number in the middle; routing that through a charting component costs a
 * wrapper, a responsive container and a layout pass to draw a circle, and
 * fights you over the one thing that matters here — the label sitting exactly
 * in the centre at a size that reads.
 *
 * `used` may exceed 100. The arc stops at the full circle because there is no
 * more circle, but the colour changes and the figure below says by how much:
 * an over-contribution is penalised monthly and is the one state on this card
 * that needs acting on.
 */
export function RoomGauge({
  label,
  used,
  tone = "brand",
  caption,
  detail,
  over = false,
}: {
  label: string;
  /** Percentage used, or null when the room has never been entered. */
  used: number | null;
  tone?: AccentName;
  caption: string;
  detail?: string;
  over?: boolean;
}) {
  const R = 42;
  const C = 2 * Math.PI * R;
  const known = used !== null;
  const shown = known ? Math.max(0, Math.min(used, 100)) : 0;
  const colour = over ? accent("negative") : accent(tone);

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative">
        <svg width="112" height="112" viewBox="0 0 112 112" role="img"
             aria-label={`${label}: ${known ? `${Math.round(used)}% of room used` : "room not set"}`}>
          <circle
            cx="56" cy="56" r={R} fill="none" strokeWidth="9"
            className="stroke-line"
            strokeDasharray={known ? undefined : "3 5"}
          />
          {known && (
            <circle
              cx="56" cy="56" r={R} fill="none" stroke={colour} strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${(shown / 100) * C} ${C}`}
              /* Start at twelve o'clock rather than three, which is where a
                 dial is read from. */
              transform="rotate(-90 56 56)"
              style={{ transition: "stroke-dasharray 600ms cubic-bezier(0.4, 0, 0.2, 1)" }}
            />
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {known ? (
            <>
              <span className="text-xl font-semibold tabular-nums leading-none">
                {Math.round(used)}
                <span className="text-xs font-normal text-ink-faint">%</span>
              </span>
              <span className="mt-0.5 text-[0.625rem] uppercase tracking-wider text-ink-faint">
                used
              </span>
            </>
          ) : (
            <span className="text-[0.625rem] uppercase tracking-wider text-ink-faint">
              not set
            </span>
          )}
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-semibold tracking-wide">{label}</p>
        <p className="mt-0.5 text-[0.6875rem] tabular-nums text-ink-dim">{caption}</p>
        {detail ? (
          <p className={cn("mt-0.5 text-[0.6875rem] tabular-nums",
                           over ? "text-negative" : "text-ink-faint")}>
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- Waterfall ---------------- */

/**
 * A year's move from one net worth to the next, as floating columns.
 *
 * Two totals at the ends standing on the axis, and between them the steps that
 * got from one to the other, each starting where the last finished. It is the
 * one arrangement that shows cash flow and balance sheet as the same statement
 * rather than two: the columns are the year's income and spending, and the
 * pillars they sit between are the balance sheet on 1 January and 31 December.
 *
 * Recharts draws this with two stacked bars — an invisible one lifting the
 * visible one off the axis — because a bar chart cannot otherwise start
 * anywhere but zero.
 */
/** One definition, so the connector maths below cannot drift from the plot. */
const WATERFALL_MARGIN = { top: 30, right: 8, left: 8, bottom: 4 };
/** Room under the lowest column for a falling step's figure. */
const WATERFALL_UNDER = 22;

type WaterfallRole = "balance" | "income" | "spending" | "market";

export function Waterfall({
  steps,
  format,
  height = 300,
}: {
  steps: {
    label: string;
    delta: number;
    base: number;
    top: number;
    kind: "total" | "up" | "down";
    role?: WaterfallRole;
  }[];
  format: (n: number) => string;
  /** A percentage fills whatever box the card gives it. See SeriesChart. */
  height?: number | `${number}%`;
}) {
  /*
   * The axis starts below the lowest level the year reaches, not at zero.
   *
   * A year moves net worth by a fraction of what it already is, so against a
   * zero baseline the two end pillars tower over the steps between them and
   * the steps — the entire subject of the chart — are squeezed into a band too
   * thin to compare.
   *
   * Everything here is proportional to the year's own movement, so the chart
   * looks the same whether the balance is four figures or eight. Two cases it
   * has to survive: a balance below zero, where the floor goes below zero with
   * it, and a year that did not move, where there is no span to scale against
   * and the window comes from the size of the balance instead.
   */
  const edges = steps.flatMap((s) => (s.kind === "total" ? [s.top] : [s.base, s.top]));
  const low = Math.min(...edges);
  const high = Math.max(...edges);
  const moved = high - low;
  const span = moved > 0 ? moved : Math.max(Math.abs(high) * 0.02, 1);
  const raw = low - span * 0.45;
  /*
   * A record that sits near zero keeps a true zero baseline. Cutting the axis
   * under a small balance would blow ordinary movement up into a cliff, which
   * is the distortion this is meant to avoid rather than cause.
   */
  const floor = low >= 0 && raw < 0 ? 0 : raw;
  /*
   * Headroom over the tallest column, inside the plot. The figures are drawn
   * with the columns, and the plot clips what it draws: at the data's own
   * maximum the two highest figures fell off the top edge.
   */
  const ceiling = high + span * 0.24;

  const rows = steps.map((s) => ({
    label: s.label,
    /*
     * A range, not a stack.
     *
     * The first version lifted each column with a transparent bar beneath it,
     * which cannot express a column below the axis: the visible part came out
     * as a negative height and was clamped to nothing, so anyone whose net
     * worth was under water — a loan against a small balance, which is where a
     * lot of records start — got an empty chart.
     */
    range:
      s.kind === "total"
        ? ([Math.min(floor, s.top), Math.max(floor, s.top)] as [number, number])
        : ([Math.min(s.base, s.top), Math.max(s.base, s.top)] as [number, number]),
    kind: s.kind,
    role: s.role ?? (s.kind === "total" ? "balance" : s.kind === "up" ? "income" : "spending"),
    delta: s.delta,
    top: s.top,
  }));

  /*
   * Colour says what a step is; its position says which way it went.
   *
   * Earned in the app's green and spent in its red, as on every other page.
   * What markets and everything else did takes the market colour whichever
   * way it moved — a fall in the portfolio is not spending, and painting it
   * the colour of rent claimed that it was.
   *
   * The two balances are the same kind of quantity a year apart, so they
   * share one colour, the brand violet, drawn as solidly as the steps.
   *
   * Every column also carries its signed figure, so no step is told apart
   * by colour alone.
   */
  const colourFor = (role: WaterfallRole) =>
    role === "income"
      ? accent("positive")
      : role === "spending"
        ? accent("negative")
        : role === "market"
          ? accent("market")
          : accent("brand");

  const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "\u2212" : "") + format(Math.abs(n));

  /*
   * A percentage height has to be passed down, not just set.
   *
   * The note under the chart means there is a wrapper between the card and the
   * plot, and a wrapper of its own height is nothing for a percentage to
   * resolve against — the plot collapsed to nought and the card drew a caption
   * over empty space. Told to fill, the wrapper becomes the column that fills
   * and the plot takes what the note leaves.
   */
  const fills = typeof height === "string";
  return (
    <div className={cn("w-full", fills && "flex h-full flex-col")}>
      <div
        className={fills ? "min-h-0 flex-1" : undefined}
        style={fills ? { width: "100%" } : { width: "100%", height }}
      >
      <ResponsiveContainer>
        <ComposedChart
          data={rows}
          margin={{ ...WATERFALL_MARGIN, bottom: WATERFALL_MARGIN.bottom + WATERFALL_UNDER }}
          barCategoryGap="22%"
        >
          {/*
            * No y-axis. Every column carries its own figure, so an axis would
            * repeat in a coarser form what the labels say exactly. A few
            * hairlines stay, recessive, so a level can be carried across the
            * gaps between columns by eye.
            */}
          <CartesianGrid vertical={false} stroke="var(--line)" strokeOpacity={0.5} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
            axisLine={{ stroke: "var(--line)" }}
            tickLine={false}
            tickMargin={10}
            interval={0}
          />
          <YAxis hide domain={[floor, ceiling]} allowDataOverflow />
          <Tooltip
            cursor={{ fill: "var(--elevated)", opacity: 0.5 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]?.payload as (typeof rows)[number] | undefined;
              if (!r) return null;
              return (
                <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-xl">
                  <p className="mb-1 flex items-center gap-1.5 text-[0.6875rem] font-medium text-ink-faint">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: colourFor(r.role) }}
                    />
                    {r.label}
                  </p>
                  <p className="text-xs font-medium tabular-nums text-ink">
                    {r.kind === "total" ? format(r.top) : signed(r.delta)}
                  </p>
                  {r.kind !== "total" && (
                    <p className="mt-0.5 text-[0.6875rem] tabular-nums text-ink-faint">
                      Leaves net worth at {format(r.top)}
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Bar
            dataKey="range"
            /*
             * About as wide as the gap beside it. Capped narrow in a wide card
             * the columns left twice their own width of air between them and
             * read as five unrelated marks; sized from the slot they read as
             * slabs. Column and gap roughly equal is where a staircase still
             * reads as one shape and each step still reads as a column. Every
             * column the same width, balances included: they are all the same
             * kind of mark, measured on the same scale.
             */
            maxBarSize={96}
            minPointSize={3}
            isAnimationActive={false}
            shape={(props: unknown) => {
              const { x, y, width, height, index, parentViewBox } = props as {
                x: number; y: number; width: number; height: number;
                index: number;
                parentViewBox?: { width: number };
              };
              const r = rows[index];
              if (!r) return <g />;
              const colour = colourFor(r.role);
              const balance = r.kind === "total";
              /*
               * The running level after this step: the top of a rise, the
               * bottom of a fall, the top of a balance.
               */
              const handOff = r.kind === "down" ? y + height : y;
              const plot = parentViewBox
                ? parentViewBox.width - WATERFALL_MARGIN.left - WATERFALL_MARGIN.right
                : null;
              const next = plot !== null ? x + plot / rows.length : null;
              return (
                <Layer>
                  {balance ? (
                    <Rectangle
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      radius={[4, 4, 0, 0]}
                      fill={colour}
                    />
                  ) : (
                    <Rectangle x={x} y={y} width={width} height={height} radius={4} fill={colour} />
                  )}
                  {/*
                    * The level, carried to the next column. Solid and faint:
                    * it is a guide to read by, not a mark to read.
                    */}
                  {next !== null && index < rows.length - 1 && (
                    <line
                      x1={x + width}
                      y1={handOff}
                      x2={next}
                      y2={handOff}
                      stroke="var(--ink-faint)"
                      strokeOpacity={0.55}
                      strokeWidth={1}
                    />
                  )}
                  {/*
                    * The figure, in ink rather than the column's colour, above
                    * a column that rose and below one that fell — where the
                    * eye already is when it follows the step.
                    */}
                  <text
                    x={x + width / 2}
                    y={r.kind === "down" ? y + height + 16 : y - 9}
                    textAnchor="middle"
                    fontSize={balance ? 12 : 11}
                    fontWeight={balance ? 600 : 500}
                    fill={balance ? "var(--ink)" : "var(--ink-dim)"}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {balance ? format(r.top) : signed(r.delta)}
                  </text>
                </Layer>
              );
            }}
          >
            {rows.map((r, i) => (
              <Cell key={i} fill={colourFor(r.role)} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ---------------- Sankey ---------------- */

/**
 * A year's whole cash flow: where every dollar came from, which account it
 * landed in, and where it went from there.
 *
 * The one chart on the page that shows every part at full detail at once.
 * Everything else answers a question about the year; this is the year.
 *
 * Node colour carries the role — arriving, held, leaving, kept — because a
 * Sankey read without it is a tangle of equally-weighted ribbons, and where in
 * the run a band sits is the first thing anyone needs to know.
 */
const FLOW_TONE: Record<string, AccentName> = {
  source: "positive",
  account: "brand",
  necessity: "negative",
  discretionary: "cost",
  investing: "market",
  pension: "pension",
  kept: "bonds",
  /* Debt repayment buys nothing, so it takes neither spending colour. */
  debt: "passive",
  /* Still sitting in the account it arrived in, so: the account's own colour. */
  idle: "brand",
};

export function YearSankey({
  nodes,
  links,
  format,
  height,
}: {
  nodes: { name: string; role?: string }[];
  links: { source: number; target: number; value: number }[];
  format: (n: number) => string;
  height?: number;
}) {
  if (nodes.length === 0 || links.length === 0) return null;

  /*
   * Where every bar stands and in what order, and the slots that carry a band
   * through a column it would otherwise be drawn across. All of it is
   * arithmetic over the nodes and the links, so it lives in `flow-layout`
   * where it is tested without a browser — this only draws the answer.
   */
  const { nodes: drawNodes, links: drawLinks, ghosts, carries } = layoutFlow(nodes, links);

  const depth = columnsOf({ nodes: drawNodes, links: drawLinks });
  const last = Math.max(...depth);

  /*
   * Colour says what a node is, and the data layer is what knows. Reading it
   * off the column put every ribbon on the right in the same red, so a deposit
   * into a pension and a month of groceries were the same thing to look at;
   * reading it off the name meant the chart had to keep a list of them.
   */
  const colourOf = (index: number) => {
    const role = drawNodes[carries.get(index) ?? index]?.role;
    if (role && FLOW_TONE[role]) return accent(FLOW_TONE[role]);
    if (depth[index] === 0) return accent("positive");
    return depth[index] < last ? accent("brand") : accent("negative");
  };

  /*
   * Tall enough for the column that has the most in it.
   *
   * A fixed height had every node in the busiest column share whatever was
   * left after the padding between them, so the labels of the small ones
   * closed up and the last one ran off the bottom of the plot. The chart grows
   * with the year instead: someone with four categories gets a short chart and
   * someone with twenty gets a legible one.
   */
  const perColumn = depth.reduce<Record<number, number>>((acc, d, i) => {
    if (!ghosts.has(i)) acc[d] = (acc[d] ?? 0) + 1;
    return acc;
  }, {});
  const busiest = Math.max(...Object.values(perColumn));
  const drawHeight = height ?? Math.min(900, Math.max(360, busiest * 42 + 64));

  return (
    <div style={{ width: "100%", height: drawHeight }}>
      <ResponsiveContainer>
        <Sankey
          data={{ nodes: drawNodes, links: drawLinks }}
          nodePadding={26}
          nodeWidth={12}
          /*
           * A bar stands where it is reached. The layout's own default drags
           * anything with nothing leaving it to the far edge, which is the
           * tidy right-hand side paid for by bands that cross the whole chart
           * — see the column arithmetic in flow-layout.
           */
          align="left"
          /*
           * Keep each column in the order the data gives it. The relaxation
           * still decides how far apart the nodes sit; this only stops it
           * reordering them, which is what pulled what was kept up among the
           * spending categories — it has one source and no destination, so
           * nothing below held it down.
           */
          sort={false}
          /*
           * Room under the plot as well as over it. The label of the lowest
           * node sits below its middle, and its amount below that again, so a
           * bottom margin of a few pixels cut the figure off the last income
           * stream on the chart.
           */
          margin={{ top: 30, right: 136, bottom: 26, left: 112 }}
          /*
           * Ribbons carry the colour of where they end.
           *
           * A band that arrives at Kept is that colour for its whole length,
           * so the eye follows it across the chart, and it never takes the
           * colour of something it merely passed. The band that skips a column
           * is routed through a reserved slot rather than over the bar there —
           * see the detour above — so the two carry the same colour and read
           * as one.
           */
          link={(props: unknown) => {
            const { sourceX, sourceY, sourceControlX, targetX, targetY, targetControlX, linkWidth, payload } =
              props as {
                sourceX: number; sourceY: number; sourceControlX: number;
                targetX: number; targetY: number; targetControlX: number;
                linkWidth: number;
                payload?: { target?: { name?: string } };
              };
            const at = drawNodes.findIndex((n) => n.name === payload?.target?.name);
            return (
              <Layer>
                <path
                  d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                  fill="none"
                  stroke={at >= 0 ? colourOf(at) : "var(--ink-faint)"}
                  strokeWidth={linkWidth}
                  strokeOpacity={0.2}
                />
              </Layer>
            );
          }}
          node={(props: unknown) => {
            const { x, y, width, height: h, index, payload } = props as {
              x: number; y: number; width: number; height: number; index: number;
              payload: { name: string; value: number; depth?: number };
            };
            /*
             * The reserved slot is drawn as the ribbon passing through it, not
             * as a bar. Its box is exactly as wide as every other node and as
             * tall as the band that runs through it, so filling it with the
             * ribbon's own colour and opacity closes the gap the node would
             * otherwise leave — the two halves either side read as one band.
             */
            if (ghosts.has(index))
              return (
                <Layer key={index}>
                  <Rectangle
                    x={x}
                    y={y}
                    width={width}
                    height={h}
                    fill={colourOf(index)}
                    fillOpacity={0.2}
                  />
                </Layer>
              );
            const colour = colourOf(index);
            /*
             * Labels outside the column rather than on it. A node can be a few
             * pixels tall — a category that took very little — and text laid
             * over it is unreadable at exactly the sizes where the reader most
             * needs to know what it is.
             */
            /*
             * Where the band stops, not which column it stopped in.
             *
             * An ending is labelled to its right and a starting point to its
             * left, wherever either stands: nothing is drawn past an ending,
             * so the space beside it is free. Only a bar with bands on both
             * sides is labelled above, because a label either side of one of
             * those lands on the very flow it names.
             */
            const d = payload.depth ?? depth[index] ?? 0;
            const ends = !drawLinks.some((l) => l.source === index);
            const starts = d === 0;
            const middle = !ends && !starts;
            const tx = middle ? x + width / 2 : starts ? x - 8 : x + width + 8;
            const anchor = middle ? "middle" : starts ? "end" : "start";
            const ty = middle ? y - 16 : y + h / 2;
            return (
              <Layer key={index}>
                <Rectangle x={x} y={y} width={width} height={h} fill={colour} radius={2} />
                <text
                  x={tx}
                  y={ty}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="var(--ink-dim)"
                >
                  {payload.name}
                </text>
                <text
                  x={tx}
                  y={ty + 12}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="var(--ink-faint)"
                >
                  {format(payload.value)}
                </text>
              </Layer>
            );
          }}
        >
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]?.payload as { name?: string; value?: number } | undefined;
              if (!p) return null;
              return (
                <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-xl">
                  {p.name ? (
                    <p className="mb-0.5 text-[0.6875rem] font-medium text-ink-faint">{p.name}</p>
                  ) : null}
                  <p className="text-xs font-medium tabular-nums text-ink">
                    {format(Number(p.value ?? 0))}
                  </p>
                </div>
              );
            }}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
