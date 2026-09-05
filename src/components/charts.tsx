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
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "./ui";
import { accent, spectrumAt } from "@/lib/palette";

export { spectrumAt } from "@/lib/palette";

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
   * moved between $480k and $516k was drawn as a flat line four fifths of the
   * way up the box — the movement, which is the only thing a sparkline is for,
   * was a rounding error against the distance to zero. A tenth of the range is
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
          {fadeAtZero &&
            series.map((s, i) => (
              <linearGradient
                key={`fade-${s.key}`}
                id={`fade-${gid}-${i}`}
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                {presenceRamp(data, s.key).map((op, j, all) => (
                  <stop
                    key={j}
                    offset={`${all.length > 1 ? (j / (all.length - 1)) * 100 : 0}%`}
                    stopColor={s.color}
                    stopOpacity={op}
                  />
                ))}
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
          domain={yDomain}
          ticks={yDomain ? [0, 25, 50, 75, 100] : undefined}
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
              stroke={fadeAtZero ? `url(#fade-${gid}-${i})` : s.color}
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
  height?: number;
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

export function ExposurePie({
  data,
  height = 300,
  fmt,
  legend = "below",
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
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  /*
   * One step of the spectrum per holding, in the order they arrive — which is
   * largest first. Colour is position in the ring, not asset class: the class
   * is a tag on the legend row instead, which says the same thing without
   * spending a whole hue family on a class that holds two positions.
   */
  const colored = byValueDesc(data).map((d, i) => ({
    ...d,
    color: spectrumAt(i, data.length),
  }));

  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—");

  const beside = legend === "right";
  return (
    <div className={cn(beside && "flex flex-col gap-5 lg:flex-row lg:items-center")}>
      <div className={cn(beside && "lg:w-2/5 lg:shrink-0")}>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={colored}
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
              {colored.map((d) => (
                <Cell key={d.ticker} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              content={<ChartTooltip fmt={(n) => `${fmt ? fmt(n) : n} · ${pct(n)}`} />}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/*
        One row per holding, because that is now what a colour means. It used
        to be one row per asset class with the holdings inside it as a bar; the
        classes are still here, as a tag, but they no longer decide the colour
        and so cannot organise the key.
      */}
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
