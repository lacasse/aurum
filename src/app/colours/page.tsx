"use client";

/**
 * A bench for picking colours. Temporary.
 *
 * Every chart the app draws, once each, on invented figures that are shaped
 * like the real ones — enough slices to spread the spectrum across, enough
 * months to see a line move. Change a swatch and everything here repaints.
 *
 * The palette it edits is the one the rest of the app draws from, stored in
 * the browser, so a colour settled on here is what the dashboard shows on the
 * next visit. Reset puts the shipped defaults back.
 *
 * To remove this page: delete this directory, the `/colours` entry in
 * `src/components/shell.tsx`, and `src/lib/palette.ts` — moving the spectrum
 * and the accents in that last file back into `src/components/charts.tsx`.
 */

import { useMemo } from "react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Button, Card, CardHeader } from "@/components/ui";
import {
  BudgetVsActual,
  ChartLegend,
  DonutChart,
  ExposurePie,
  GroupedBars,
  RadialGauge,
  SeriesChart,
  SignedHBars,
  TwrChart,
  categoryColors,
} from "@/components/charts";
import {
  DEFAULT_ACCENTS,
  DEFAULT_SPECTRUM,
  isCustomised,
  resetPalette,
  setAccent,
  setSpectrumStop,
  spectrumAt,
  usePalette,
  type AccentName,
} from "@/lib/palette";
import { fmtCAD, fmtCompact } from "@/lib/format";

/** What each accent is for, in the words the palette module uses. */
const ACCENT_NOTES: Record<AccentName, string> = {
  positive: "Money arriving — income, gains",
  negative: "Money leaving — expenses, debt, losses",
  brand: "Net worth, and the default sparkline",
  market: "Market value, second of a pair",
  cost: "What was paid — cost basis, budgets, benchmarks",
  pension: "The pension band",
  bonds: "Bonds and fixed income",
  passive: "Passive income",
};

const MONTHS = [
  "Oct 2025",
  "Nov 2025",
  "Dec 2025",
  "Jan 2026",
  "Feb 2026",
  "Mar 2026",
  "Apr 2026",
  "May 2026",
  "Jun 2026",
  "Jul 2026",
  "Aug 2026",
  "Sep 2026",
];

/*
 * Invented, but shaped like the real thing: income steady with a bonus month,
 * spending lumpy, a portfolio that runs ahead of its cost and gives some of it
 * back. Deterministic — a chart that reshuffles on every keystroke is useless
 * for judging a colour.
 */
const wobble = (i: number, scale: number) =>
  Math.round((Math.sin(i * 1.7) + Math.cos(i * 0.9)) * scale);

/**
 * A swatch that opens the browser's colour picker.
 *
 * The native `input[type=color]` is laid over the tile at zero opacity rather
 * than styled, because the control itself cannot be styled in any browser and
 * every hand-rolled picker is worse than the operating system's own.
 */
function Swatch({
  hex,
  label,
  note,
  isDefault,
  onChange,
}: {
  hex: string;
  label: string;
  note?: string;
  isDefault: boolean;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="relative h-14 overflow-hidden rounded-lg border border-line">
        <div className="absolute inset-0" style={{ background: hex }} />
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <p className="mt-1 truncate text-[0.6875rem] font-medium text-ink-dim">
        {label}
      </p>
      <p className="font-mono text-[0.625rem] uppercase text-ink-faint">
        {hex}
        {isDefault ? "" : " ·"}
      </p>
      {note ? (
        <p className="mt-0.5 text-[0.625rem] leading-snug text-ink-faint">{note}</p>
      ) : null}
    </div>
  );
}

export default function ColoursPage() {
  const { spectrum, accents } = usePalette();

  const data = useMemo(() => {
    const cashflow = MONTHS.map((label, i) => ({
      label,
      income: 7800 + wobble(i, 900) + (i === 11 ? 6000 : 0),
      expenses: 5200 + wobble(i, 1400),
    }));

    const composition = MONTHS.map((label, i) => ({
      label,
      Cash: 8 + wobble(i, 2),
      Bonds: 6 + wobble(i, 1),
      Pension: i < 3 ? 0 : 14 + wobble(i, 2),
      Stocks: 34 + wobble(i, 4),
      Crypto: 38 + wobble(i, 5),
    }));

    const incomeBySource = MONTHS.map((label, i) => ({
      label,
      Salary: 6200,
      Dividends: 240 + wobble(i, 60),
      Interest: 90 + wobble(i, 30),
      "RSP / Pension": 1100,
      Refund: i === 4 ? 2400 : 0,
    }));

    const spend = [
      { name: "Housing", value: 2150 },
      { name: "Groceries", value: 940 },
      { name: "Transport", value: 610 },
      { name: "Dining", value: 480 },
      { name: "Utilities", value: 310 },
      { name: "Travel", value: 260 },
      { name: "Health", value: 180 },
    ];

    const exposure = [
      { ticker: "XEQT.TO", name: "All-Equity ETF", assetClass: "Stocks", value: 96000 },
      { ticker: "BTC", name: "Bitcoin", assetClass: "Crypto", value: 74000 },
      { ticker: "VFV.TO", name: "S&P 500 ETF", assetClass: "Stocks", value: 52000 },
      { ticker: "ETH", name: "Ethereum", assetClass: "Crypto", value: 38000 },
      { ticker: "TSLA", name: "Tesla", assetClass: "Stocks", value: 24000 },
      { ticker: "ZAG.TO", name: "Aggregate Bond", assetClass: "Bonds", value: 18000 },
      { ticker: "CASH.TO", name: "High Interest Savings", assetClass: "Cash", value: 12000 },
      { ticker: "NVDA", name: "Nvidia", assetClass: "Stocks", value: 9000 },
      { ticker: "CAGE", name: "Cage Corp", assetClass: "Stocks", value: 4000 },
    ];

    const twr = MONTHS.map((label, i) => ({
      label,
      portfolio: Number((i * 1.6 + wobble(i, 3)).toFixed(1)),
      benchmark: Number((i * 1.1 + wobble(i, 2)).toFixed(1)),
    }));

    const gainLoss = [
      { name: "BTC", gain: 41200 },
      { name: "XEQT.TO", gain: 18400 },
      { name: "VFV.TO", gain: 9100 },
      { name: "NVDA", gain: 2600 },
      { name: "ZAG.TO", gain: -1400 },
      { name: "TSLA", gain: -8800 },
      { name: "ETH", gain: -21500 },
    ];

    const budget = [
      { category: "Housing", budgeted: 2000, spent: 2150 },
      { category: "Groceries", budgeted: 1000, spent: 940 },
      { category: "Transport", budgeted: 500, spent: 610 },
      { category: "Dining", budgeted: 400, spent: 480 },
      { category: "Utilities", budgeted: 350, spent: 310 },
    ];

    const portfolio = MONTHS.map((label, i) => ({
      label,
      value: 240000 + i * 9000 + wobble(i, 12000),
      cost: 210000 + i * 4200,
    }));

    return {
      cashflow,
      composition,
      incomeBySource,
      spend,
      exposure,
      twr,
      gainLoss,
      budget,
      portfolio,
    };
  }, []);

  /*
   * The spectrum spread across each set of categories, exactly as the real
   * pages do it — so the colours here are the colours those pages get.
   */
  const spendColors = categoryColors(data.spend.map((c) => c.name));
  const compositionBands = ["Cash", "Bonds", "Pension", "Stocks", "Crypto"];
  const incomeSources = ["Salary", "RSP / Pension", "Dividends", "Interest", "Refund"];

  return (
    <Shell
      title="Colours"
      subtitle="A bench for picking the palette — every chart, on invented figures"
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={resetPalette}
          disabled={!isCustomised()}
        >
          Reset to defaults
        </Button>
      }
    >
      <div className="space-y-4">
        <Card>
          <CardHeader
            title="The spectrum"
            subtitle="Every ring, donut and category band is sampled from these thirteen stops, in order. Click one to change it."
          />
          <div className="grid grid-cols-4 gap-3 px-5 pb-5 sm:grid-cols-7 lg:grid-cols-13">
            {spectrum.map((hex, i) => (
              <Swatch
                key={i}
                hex={hex}
                label={`Stop ${i + 1}`}
                isDefault={hex === DEFAULT_SPECTRUM[i]}
                onChange={(next) => setSpectrumStop(i, next)}
              />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="The named colours"
            subtitle="These mean something in themselves rather than being the nth of a set, so they are not part of the ramp above."
          />
          <div className="grid grid-cols-2 gap-4 px-5 pb-5 sm:grid-cols-4 lg:grid-cols-8">
            {(Object.keys(accents) as AccentName[]).map((name) => (
              <Swatch
                key={name}
                hex={accents[name]}
                label={name}
                note={ACCENT_NOTES[name]}
                isDefault={accents[name] === DEFAULT_ACCENTS[name]}
                onChange={(next) => setAccent(name, next)}
              />
            ))}
          </div>
        </Card>

        {/* Sparklines, as the stat cards carry them */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Net worth"
            value={fmtCAD(data.portfolio[11].value)}
            deltaValue={fmtCAD(9000)}
            deltaDir="up"
            tone="positive"
            deltaLabel="vs last month"
            spark={data.portfolio.map((p) => ({ v: p.value }))}
            sparkKey="v"
            sparkColor={accents.brand}
          />
          <StatCard
            label="Monthly income"
            value={fmtCAD(7800)}
            deltaValue={fmtCAD(420)}
            deltaDir="up"
            tone="positive"
            deltaLabel="vs last year"
            spark={data.cashflow.map((m) => ({ v: m.income }))}
            sparkKey="v"
            sparkColor={accents.positive}
          />
          <StatCard
            label="Monthly expenses"
            value={fmtCAD(5200)}
            deltaValue={fmtCAD(180)}
            deltaDir="down"
            tone="positive"
            deltaLabel="vs last year"
            spark={data.cashflow.map((m) => ({ v: m.expenses }))}
            sparkKey="v"
            sparkColor={accents.negative}
          />
          <StatCard
            label="Passive income"
            value={fmtCAD(330)}
            deltaValue={fmtCAD(40)}
            deltaDir="down"
            tone="negative"
            deltaLabel="vs last year"
            spark={data.incomeBySource.map((m) => ({ v: m.Dividends + m.Interest }))}
            sparkKey="v"
            sparkColor={accents.passive}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Dashboard · Income vs expenses */}
          <Card>
            <CardHeader
              title="Income vs expenses"
              subtitle="Area chart · two series, filled"
            />
            <div className="px-3 pb-4">
              <SeriesChart
                data={data.cashflow as unknown as Record<string, unknown>[]}
                xKey="label"
                series={[
                  { key: "income", name: "Income", color: accents.positive },
                  { key: "expenses", name: "Expenses", color: accents.negative },
                ]}
                height={280}
                yFmt={fmtCompact}
              />
            </div>
          </Card>

          {/* Investments · Portfolio growth */}
          <Card>
            <CardHeader
              title="Portfolio growth"
              subtitle="Area chart · market value against the cost line under it"
            />
            <div className="px-3 pb-4">
              <SeriesChart
                data={data.portfolio as unknown as Record<string, unknown>[]}
                xKey="label"
                series={[
                  { key: "value", name: "Market value", color: accents.market },
                  { key: "cost", name: "Invested cost", color: accents.cost, dashed: true },
                ]}
                height={280}
                yFmt={fmtCompact}
              />
            </div>
          </Card>
        </div>

        {/* Dashboard · Net worth composition */}
        <Card>
          <CardHeader
            title="Net worth composition"
            subtitle="Stacked areas, faded where a band is empty · the named colours, one per band"
          />
          <div className="px-3 pb-2">
            <SeriesChart
              data={data.composition as unknown as Record<string, unknown>[]}
              xKey="label"
              stacked
              fadeAtZero
              series={[
                { key: "Cash", name: "Cash", color: accents.positive },
                { key: "Bonds", name: "Bonds", color: accents.bonds },
                { key: "Pension", name: "Pension", color: accents.pension },
                { key: "Stocks", name: "Stocks", color: accents.cost },
                { key: "Crypto", name: "Crypto", color: accents.brand },
              ]}
              height={280}
              yDomain={[0, 100]}
              yFmt={(n) => `${Math.round(n)}%`}
            />
          </div>
          <div className="px-5 pb-5">
            <ChartLegend
              items={compositionBands.map((name) => ({
                label: name,
                color: {
                  Cash: accents.positive,
                  Bonds: accents.bonds,
                  Pension: accents.pension,
                  Stocks: accents.cost,
                  Crypto: accents.brand,
                }[name] as string,
              }))}
            />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Income · month by month */}
          <Card>
            <CardHeader
              title="Income month by month"
              subtitle="Stacked bars · the spectrum across five sources, only the top rounded"
            />
            <div className="px-3 pb-4">
              <GroupedBars
                data={data.incomeBySource as unknown as Record<string, unknown>[]}
                xKey="label"
                stacked
                bars={incomeSources.map((name, i) => ({
                  key: name,
                  name,
                  color: spectrumAt(i, incomeSources.length),
                }))}
                height={280}
                yFmt={fmtCompact}
              />
            </div>
          </Card>

          {/* Transactions · filtered cash flow */}
          <Card>
            <CardHeader
              title="Filtered cash flow"
              subtitle="Grouped bars · side by side, every bar rounded"
            />
            <div className="px-3 pb-4">
              <GroupedBars
                data={data.cashflow as unknown as Record<string, unknown>[]}
                xKey="label"
                bars={[
                  { key: "income", name: "Income", color: accents.positive },
                  { key: "expenses", name: "Expenses", color: accents.negative },
                ]}
                height={280}
                yFmt={fmtCompact}
              />
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Dashboard · where money went */}
          <Card>
            <CardHeader
              title="Where money went"
              subtitle="Donut · the spectrum across seven categories, biggest first from twelve o'clock"
            />
            <div className="px-5 pb-5">
              <DonutChart
                data={data.spend}
                colors={spendColors}
                centerLabel="Per month"
                centerValue={fmtCAD(data.spend.reduce((s, c) => s + c.value, 0))}
                fmt={(n) => fmtCAD(n)}
                height={280}
              />
            </div>
          </Card>

          {/* Investments · holdings exposure */}
          <Card>
            <CardHeader
              title="Holdings exposure"
              subtitle="Pie with a legend · one spectrum step per position, largest to smallest"
            />
            <div className="px-5 pb-5">
              <ExposurePie
                data={data.exposure}
                height={280}
                fmt={(n) => fmtCAD(n)}
              />
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Investments · TWR vs benchmark */}
          <Card>
            <CardHeader
              title="Time-weighted return vs XEQT"
              subtitle="Two lines with a zero rule · market against cost"
            />
            <div className="px-3 pb-4">
              <TwrChart
                data={data.twr as unknown as Record<string, unknown>[]}
                height={280}
                benchmarkName="XEQT.TO"
              />
            </div>
          </Card>

          {/* Investments · gain / loss by position */}
          <Card>
            <CardHeader
              title="Gain / loss by position"
              subtitle="Signed horizontal bars · positive and negative, nothing else"
            />
            <div className="px-3 pb-4">
              <SignedHBars
                data={data.gainLoss as unknown as Record<string, unknown>[]}
                labelKey="name"
                valueKey="gain"
                height={280}
                fmt={fmtCompact}
              />
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Expenses · budget vs actual */}
          <Card className="lg:col-span-2">
            <CardHeader
              title="Budget vs actual"
              subtitle="Grouped bars · the plan in muted ink, the spending in brand"
            />
            <div className="px-3 pb-4">
              <BudgetVsActual data={data.budget} height={280} fmt={fmtCompact} />
            </div>
          </Card>

          {/* The gauge, at each of its three states */}
          <Card>
            <CardHeader
              title="Radial gauge"
              subtitle="Green under 80%, amber to 100%, red over"
            />
            <div className="grid grid-cols-3 gap-2 px-3 pb-5">
              <RadialGauge pct={46} label="Under" height={150} />
              <RadialGauge pct={88} label="Close" height={150} />
              <RadialGauge pct={118} label="Over" height={150} />
            </div>
          </Card>
        </div>

        {/* The spectrum on its own, at the sizes the charts sample it at */}
        <Card>
          <CardHeader
            title="The spectrum, sampled"
            subtitle="What the ramp gives a chart with that many slices — how a five-slice donut and a thirteen-slice ring each read"
          />
          <div className="space-y-2 px-5 pb-5">
            {[3, 5, 7, 9, 13].map((n) => (
              <div key={n} className="flex items-center gap-3">
                <span className="w-8 shrink-0 text-right font-mono text-[0.6875rem] text-ink-faint">
                  {n}
                </span>
                <div className="flex h-8 flex-1 overflow-hidden rounded-md">
                  {Array.from({ length: n }, (_, i) => (
                    <div
                      key={i}
                      className="flex-1"
                      style={{ background: spectrumAt(i, n) }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <p className="px-1 pb-2 text-[0.6875rem] leading-relaxed text-ink-faint">
          The palette is stored in this browser, not in the database. Charts
          drawn by shared components pick it up everywhere in the app; a few
          pages still name their own colours in code, so those keep their
          shipped hues until they are moved onto the named colours above.
        </p>
      </div>
    </Shell>
  );
}
