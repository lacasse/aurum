"use client";

import { useId } from "react";
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
import { cn } from "./ui";
import { accent, spectrumAt, type AccentName } from "@/lib/palette";

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
export function Waterfall({
  steps,
  format,
  height = 300,
}: {
  steps: { label: string; delta: number; base: number; top: number; kind: "total" | "up" | "down" }[];
  format: (n: number) => string;
  height?: number;
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
  const truncated = floor !== 0;

  const rows = steps.map((s) => ({
    label: s.label,
    /*
     * A range, not a stack.
     *
     * The first version lifted each column with a transparent bar beneath it,
     * which cannot express a column below the axis: the visible part came out
     * as a negative height and was clamped to nothing, so anyone whose net
     * worth was under water — a student loan against a small balance, which is
     * where a lot of records start — got an empty chart.
     */
    range:
      s.kind === "total"
        ? ([Math.min(floor, s.top), Math.max(floor, s.top)] as [number, number])
        : ([Math.min(s.base, s.top), Math.max(s.base, s.top)] as [number, number]),
    kind: s.kind,
    delta: s.delta,
    top: s.top,
    /** What the label above the column says: a total states itself, a step its change. */
    shown: s.kind === "total" ? s.top : s.delta,
  }));

  /*
   * The two totals are told apart from each other, not just from the steps
   * between them. They are the same kind of quantity a year apart, and giving
   * them one colour makes the chart read as three categories when it is really
   * two endpoints and a path between them.
   */
  const colourFor = (kind: string, i: number) =>
    kind === "total"
      ? i === 0
        ? accent("market")
        : accent("brand")
      : kind === "up"
        ? accent("positive")
        : accent("negative");

  return (
    <div className="w-full">
      <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart
          data={rows}
          margin={{ top: 28, right: 4, left: 4, bottom: 0 }}
          /*
           * All but touching.
           *
           * A waterfall is one shape: each step begins at the height the last
           * one reached, and a real gap hides that hand-off — the eye has to
           * carry the level across empty space and take it on trust. A hairline
           * keeps the path readable while stopping the columns from fusing into
           * one block, which is what butting them fully together did.
           */
          barCategoryGap={3}
        >
          {/*
            * No y-axis and no grid. Every column already carries its own figure
            * above it, so an axis repeats in a coarser form what the labels say
            * exactly — and the space it takes is the space the columns need to
            * be worth reading.
            */}
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--ink-dim)", fontSize: 11 }}
            axisLine={{ stroke: "var(--line)" }}
            tickLine={false}
            interval={0}
          />
          <YAxis hide domain={[floor, "dataMax"]} allowDataOverflow />
          <Tooltip
            cursor={{ fill: "var(--line)", opacity: 0.2 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]?.payload as (typeof rows)[number] | undefined;
              if (!r) return null;
              return (
                <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-xl">
                  <p className="mb-1 text-[0.6875rem] font-medium text-ink-faint">{r.label}</p>
                  <p className="text-xs font-medium tabular-nums text-ink">{format(r.shown)}</p>
                  {r.kind !== "total" && (
                    <p className="mt-0.5 text-[0.6875rem] tabular-nums text-ink-faint">
                      Running {format(r.top)}
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Bar
            dataKey="range"
            radius={[2, 2, 0, 0]}
            /*
             * A step small beside the totals still has to be visible. Without a
             * floor a rounding-error year is drawn as nothing at all, which
             * reads as "this did not happen" rather than "this was small".
             */
            minPointSize={3}
            isAnimationActive={false}
            label={{
              position: "top",
              offset: 8,
              content: (props: unknown) => {
                const { x, y, width, index } = props as {
                  x: number;
                  y: number;
                  width: number;
                  index: number;
                };
                const r = rows[index];
                if (!r) return null;
                const negative = r.shown < 0;
                return (
                  <text
                    x={x + width / 2}
                    y={y - 8}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={500}
                    fill={negative ? accent("negative") : "var(--ink)"}
                  >
                    {format(r.shown)}
                  </text>
                );
              },
            }}
          >
            {rows.map((r, i) => (
              <Cell key={i} fill={colourFor(r.kind, i)} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      {truncated && (
        /*
         * Said plainly rather than drawn as a break in the axis. A zigzag is a
         * convention people either know or misread, and the sentence costs one
         * line.
         */
        <p className="px-1 text-[0.625rem] text-ink-faint">
          The scale starts at {format(floor)}, not zero, so the year&rsquo;s
          movements are readable against a much larger balance.
        </p>
      )}
    </div>
  );
}

/* ---------------- Allocation bar ---------------- */

/**
 * One bar, split by share, for a quantity that adds to a whole.
 *
 * Hand-drawn rather than charted: a hundred-percent bar has no axes, no
 * gridlines and one dimension, and routing it through a chart library buys a
 * responsive container and a layout pass to draw four rectangles in a row.
 *
 * Segments too thin to see are still drawn, at a minimum width, because a
 * category that took a little is a different statement from one that took
 * nothing. Their labels drop out instead — a legend beneath carries every
 * figure, so nothing is lost by refusing to cram text into three pixels.
 */
export function AllocationBar({
  parts,
  total,
  format,
}: {
  parts: { label: string; value: number; colour: string }[];
  total: number;
  format: (n: number) => string;
}) {
  const shown = parts.filter((p) => p.value > 0);
  const sum = shown.reduce((a, p) => a + p.value, 0) || 1;

  return (
    <div className="space-y-3">
      <div className="flex h-9 w-full overflow-hidden rounded-lg">
        {shown.map((p) => {
          const share = (p.value / sum) * 100;
          return (
            <div
              key={p.label}
              className="flex items-center justify-center"
              style={{ width: `${share}%`, minWidth: 3, background: p.colour }}
              title={`${p.label} · ${format(p.value)}`}
            >
              {share >= 12 && (
                <span className="px-1 text-[0.6875rem] font-semibold text-black/75">
                  {Math.round(share)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: p.colour }}
            />
            <span className="text-ink-dim">{p.label}</span>
            <span className="ml-auto font-medium tabular-nums text-ink">
              {format(p.value)}
            </span>
            <span className="w-9 shrink-0 text-right tabular-nums text-ink-faint">
              {total > 0 ? `${Math.round((p.value / total) * 100)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Sankey ---------------- */

/**
 * A year's whole cash flow: where every dollar came from, and where it went.
 *
 * The one chart on the page that shows both halves at full detail at once.
 * Everything else answers a question about the year; this is the year.
 *
 * Node colour carries the direction — arriving, the trunk, leaving, kept —
 * because a Sankey read without it is a tangle of equally-weighted ribbons,
 * and which side of the trunk a band sits on is the first thing anyone needs
 * to know.
 */
export function YearSankey({
  nodes,
  links,
  format,
  height = 460,
}: {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
  format: (n: number) => string;
  height?: number;
}) {
  if (nodes.length === 0 || links.length === 0) return null;

  const trunk = links.find((l) => links.some((o) => o.source === l.target))?.target ?? -1;
  const incoming = new Set(links.filter((l) => l.target === trunk).map((l) => l.source));

  const colourOf = (index: number) => {
    if (index === trunk) return accent("brand");
    if (incoming.has(index)) return accent("positive");
    return nodes[index]?.name === "Kept" ? accent("market") : accent("negative");
  };

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <Sankey
          data={{ nodes, links }}
          nodePadding={18}
          nodeWidth={12}
          margin={{ top: 8, right: 132, bottom: 8, left: 108 }}
          link={{ stroke: "var(--line)", strokeOpacity: 0.28, fill: "var(--ink-faint)", fillOpacity: 0.14 }}
          node={(props: unknown) => {
            const { x, y, width, height: h, index, payload } = props as {
              x: number; y: number; width: number; height: number; index: number;
              payload: { name: string; value: number };
            };
            const colour = colourOf(index);
            /*
             * Labels outside the column rather than on it. A node can be a few
             * pixels tall — a category that took very little — and text laid
             * over it is unreadable at exactly the sizes where the reader most
             * needs to know what it is.
             */
            const left = incoming.has(index);
            return (
              <Layer key={index}>
                <Rectangle x={x} y={y} width={width} height={h} fill={colour} radius={2} />
                <text
                  x={left ? x - 8 : x + width + 8}
                  y={y + h / 2}
                  textAnchor={left ? "end" : "start"}
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="var(--ink-dim)"
                >
                  {payload.name}
                </text>
                <text
                  x={left ? x - 8 : x + width + 8}
                  y={y + h / 2 + 12}
                  textAnchor={left ? "end" : "start"}
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
