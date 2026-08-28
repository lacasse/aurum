"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Flame,
  Pencil,
  Plus,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Badge, Button, Card, CardHeader, Progress, cn } from "@/components/ui";
import {
  DonutChart,
  PALETTE,
  SectorRadar,
  SeriesChart,
  SignedHBars,
  TwrChart,
} from "@/components/charts";
import { HoldingForm, TradeEntry } from "@/components/forms";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import type { SortKey } from "@/lib/analytics";
import {
  allocationByClass,
  holdingRows,
  sortHoldingRows,
  portfolioSeries,
  sectorExposure,
} from "@/lib/analytics";
import { fmtCompact, fmtPct, fmtSignedCAD, fmtCAD, labelMonth } from "@/lib/format";
import type { Holding } from "@/lib/types";

const POLL_MS = 60 * 60_000;

interface BenchmarkData {
  name: string;
  simulated: boolean;
  note?: string;
  series: { month: string; price: number }[];
}

/**
 * A column header that sorts. The arrow only appears on the active column, so
 * the header row stays quiet until it is being used.
 */
function SortHeader({
  label,
  unit,
  sortKey,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  unit?: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={cn("px-3 py-2.5 font-medium", align === "right" && "text-right", className)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-ink",
          active && "text-ink",
        )}
      >
        <span>{label}</span>
        {unit && <span className="text-muted font-normal normal-case">{unit}</span>}
        <Arrow size={10} className={cn("shrink-0", !active && "invisible")} />
      </button>
    </th>
  );
}

export default function InvestmentsPage() {
  const ready = useReady();
  const holdings = useFinance((s) => s.holdings);
  const accounts = useFinance((s) => s.accounts);
  const updateHolding = useFinance((s) => s.updateHolding);

  /** Short label for the account a position sits in, e.g. "TFSA". */
  const accountLabel = (id: string) => {
    const account = accounts.find((a) => a.id === id);
    if (!account) return "—";
    return account.registration && account.registration !== "non-registered"
      ? account.registration
      : account.name;
  };

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Holding | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkData | null>(null);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [staleTickers, setStaleTickers] = useState<Set<string>>(new Set());
  /*
   * Sort order for the holdings table. Value descending matches how a portfolio
   * is usually read — biggest position first — so it stays the default.
   */
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "marketValue",
    dir: "desc",
  });
  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : // Text reads naturally A-Z; numbers are most useful largest-first.
          { key, dir: key === "name" ? "asc" : "desc" },
    );

  /*
   * Fully-sold positions are hidden rather than deleted, so the cost basis and
   * dividends behind a realized gain survive for tax reporting.
   */
  const [showClosed, setShowClosed] = useState(false);

  /* Tickers whose per-account lots are shown; only ever set for pooled rows. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (ticker: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  const [quota, setQuota] = useState<{
    used: number;
    limit: number;
    remaining: number;
    resetsAt: string;
  } | null>(null);
  const mountedRef = useRef(true);

  /* ---- live price polling ---- */
  const refreshPrices = useCallback(async () => {
    /*
     * One request per security, not per position, and only for securities
     * still held.
     *
     * Sending every holding meant the same ticker held in four accounts asked
     * for four prices, and a closed position asked for one at all — spending a
     * strictly limited daily allowance on securities that are no longer owned
     * and whose price changes nothing.
     */
    const priceable = new Map<string, { assetClass: string; currency: string }>();
    for (const h of holdings) {
      if (h.shares <= 0) continue;
      const key = h.ticker.trim().toUpperCase();
      if (!priceable.has(key)) {
        priceable.set(key, { assetClass: h.assetClass, currency: h.currency });
      }
    }
    if (priceable.size === 0) return;

    setPriceRefreshing(true);
    try {
      const entries = [...priceable.entries()];
      const tickers = entries.map(([t]) => t).join(",");
      const classes = entries.map(([, v]) => v.assetClass).join(",");
      const currencies = entries.map(([, v]) => v.currency).join(",");
      const res = await fetch(
        `/api/prices?tickers=${encodeURIComponent(tickers)}&classes=${encodeURIComponent(classes)}&currencies=${encodeURIComponent(currencies)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const { prices, stale, quota: q } = (await res.json()) as {
        prices: Record<string, number>;
        stale?: string[];
        quota?: { used: number; limit: number; remaining: number; resetsAt: string };
        ts: number;
      };
      if (!mountedRef.current) return;
      // Prices we could not refresh keep their last known value; the badge is
      // what tells you the figure is not from today.
      setStaleTickers(new Set(stale ?? []));
      setQuota(q ?? null);
      for (const h of holdings) {
        const px = prices[h.ticker];
        if (px != null && px > 0 && px !== h.price) {
          updateHolding(h.id, { ...h, price: px });
        }
      }
      setLastPriceUpdate(new Date());
    } catch {
      // silently keep existing prices
    } finally {
      if (mountedRef.current) setPriceRefreshing(false);
    }
  }, [holdings, updateHolding]);

  useEffect(() => {
    mountedRef.current = true;
    // Defer initial fetch to avoid setState synchronously in effect body
    const timer = setTimeout(refreshPrices, 0);
    const id = setInterval(refreshPrices, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
      clearInterval(id);
    };
  }, [refreshPrices]);

  /* ---- benchmark ---- */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/benchmark?months=18", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: BenchmarkData) => {
        if (!cancelled) setBenchmark(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const data = useMemo(() => {
    const all = sortHoldingRows(holdingRows(holdings), sort.key, sort.dir);
    const closedCount = all.filter((r) => r.closed).length;
    const rows = showClosed ? all : all.filter((r) => !r.closed);
    // Derived figures describe the live portfolio, so a closed position never
    // becomes the "best performer" on the strength of old dividends.
    const open = all.filter((r) => !r.closed);
    const series = portfolioSeries(holdings, 18);
    const allocation = allocationByClass(holdings).sort((a, b) => b.value - a.value);
    const sectors = sectorExposure(holdings);
    const totalValue = open.reduce((s, r) => s + r.marketValue, 0);
    const totalCost = open.reduce((s, r) => s + r.costBasis, 0);
    const totalDividends = open.reduce((s, r) => s + r.totalDividends, 0);
    // Only positions with a measurable return can be "best"; one entered by
    // hand has no flows and therefore no MWRR at all.
    const best = [...open]
      .filter((r) => r.mwrr !== null)
      .sort((a, b) => (b.mwrr ?? 0) - (a.mwrr ?? 0))[0];
    // Independent of the table's sort: the chart shows the ten largest
    // positions, and should not reshuffle when a column header is clicked.
    const gainBars = [...open]
      .sort((a, b) => b.marketValue - a.marketValue)
      .slice(0, 10)
      .map((r) => ({ label: r.ticker, gain: r.totalReturn }))
      .sort((a, b) => b.gain - a.gain);
    return {
      rows,
      closedCount,
      series,
      allocation,
      sectors,
      totalValue,
      totalCost,
      totalDividends,
      best,
      gainBars,
    };
  }, [holdings, sort, showClosed]);

  const twr = useMemo(() => {
    if (!benchmark || benchmark.series.length < 2) return null;
    const valueByMonth = new Map(data.series.map((p) => [p.key, p.value]));
    const priceByMonth = new Map(benchmark.series.map((p) => [p.month, p.price]));
    const months = benchmark.series
      .map((p) => p.month)
      .filter((m) => valueByMonth.has(m));
    if (months.length < 2) return null;
    const p0 = valueByMonth.get(months[0])!;
    const b0 = priceByMonth.get(months[0])!;
    if (!p0 || !b0) return null;
    const rows = months.map((m) => ({
      key: m,
      label: labelMonth(m),
      portfolio: (valueByMonth.get(m)! / p0 - 1) * 100,
      benchmark: (priceByMonth.get(m)! / b0 - 1) * 100,
    }));
    const finalRow = rows[rows.length - 1];
    return {
      rows: rows as unknown as Record<string, unknown>[],
      portfolioTwr: finalRow.portfolio,
      benchmarkTwr: finalRow.benchmark,
      alpha: finalRow.portfolio - finalRow.benchmark,
      months: months.length,
      name: benchmark.name,
      simulated: benchmark.simulated,
      note: benchmark.note,
    };
  }, [benchmark, data.series]);

  if (!ready) return <PageSkeleton />;

  const last = data.series[data.series.length - 1];
  const prev = data.series[data.series.length - 2] ?? last;
  const monthDelta = prev.value !== 0 ? ((last.value - prev.value) / prev.value) * 100 : 0;
  const unrealized = data.totalValue - data.totalCost + data.totalDividends;
  const unrealizedPct =
    data.totalCost > 0 ? (unrealized / data.totalCost) * 100 : 0;

  return (
    <Shell
      title="Investments"
      subtitle={
        <span className="flex items-center gap-2">
          <span>{holdings.length} holdings · values are manually tracked</span>
          {lastPriceUpdate && (
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive animate-pulse" />
              Prices live {lastPriceUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </span>
      }
      action={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={refreshPrices}
            disabled={priceRefreshing}
            aria-label="Refresh prices"
            title="Refresh prices now"
          >
            <RefreshCw size={15} className={priceRefreshing ? "animate-spin" : ""} />
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus size={15} /> Add holding
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {staleTickers.size > 0 && (
          <Card className="border-amber-500/40 bg-amber-500/5 p-4">
            <p className="text-sm font-medium text-amber-400">
              {staleTickers.size} price{staleTickers.size === 1 ? "" : "s"} not
              updated today
            </p>
            <p className="mt-1 text-xs text-ink-dim">
              Showing the last known price for these holdings.{" "}
              {quota
                ? `The EODHD free plan allows ${quota.limit} price lookups a day and ${quota.used} have been used. `
                : ""}
              Prices update automatically after the daily limit resets
              {quota ? ` at ${new Date(quota.resetsAt).toLocaleString()}` : " at 00:00 GMT"}
              .
            </p>
          </Card>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Portfolio value"
            value={fmtCAD(data.totalValue)}
            delta={monthDelta}
            deltaLabel="vs last month"
            icon={<TrendingUp size={16} />}
            spark={data.series.map((p) => ({ v: p.value }))}
            sparkKey="v"
            sparkColor="#22d3ee"
          />
          <StatCard
            label="Cost basis"
            value={fmtCAD(data.totalCost)}
            deltaLabel={`across ${data.rows.length} positions`}
            icon={<Flame size={16} />}
          />
          <StatCard
            label="Unrealized gain"
            value={fmtSignedCAD(unrealized)}
            delta={unrealizedPct}
            deltaLabel="of cost basis"
            tone={unrealized >= 0 ? "positive" : "negative"}
          />
          <StatCard
            label="Best performer"
            value={data.best ? data.best.ticker : "—"}
            delta={data.best?.mwrr ?? undefined}
            deltaLabel={data.best ? fmtSignedCAD(data.best.totalReturn) : "no holdings yet"}
            tone="positive"
          />
        </div>

        {/* Batch trade entry */}
        <Card>
          <CardHeader
            title="Log trades"
            subtitle="Record buys, sells, and dividends. Unknown tickers are auto-added."
            action={
              <Button variant="secondary" size="sm" onClick={() => setTradeOpen(!tradeOpen)}>
                {tradeOpen ? "Hide" : "Show"} trade log
              </Button>
            }
          />
          {tradeOpen && (
            <div className="px-3 pb-4">
              <TradeEntry onComplete={() => {}} />
            </div>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Portfolio growth"
              subtitle="Market value vs invested cost · 18 months"
            />
            <div className="px-3 pb-4">
              <SeriesChart
                data={data.series as unknown as Record<string, unknown>[]}
                xKey="label"
                series={[
                  { key: "value", name: "Market value", color: "#22d3ee" },
                  { key: "cost", name: "Cost basis", color: "#6e6e79", kind: "line", dashed: true },
                ]}
                height={300}
                yFmt={fmtCompact}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Asset allocation" subtitle="Share of portfolio by class" />
            <div className="px-5 pb-5">
              {data.allocation.length > 0 ? (
                <DonutChart
                  data={data.allocation}
                  centerLabel="Invested"
                  centerValue={fmtCompact(data.totalValue)}
                  fmt={(n) => fmtCAD(n)}
                  height={210}
                />
              ) : (
                <p className="py-20 text-center text-xs text-ink-faint">
                  Add a holding to get started.
                </p>
              )}
            </div>
          </Card>
        </div>

        {twr && (
          <Card>
            <CardHeader
              title="Time-weighted return vs XEQT"
              subtitle={`Cumulative growth over ${twr.months} months · no cash flows tracked, so TWR equals portfolio growth`}
              action={
                <div className="flex items-center gap-2">
                  <Badge tone={twr.alpha >= 0 ? "positive" : "negative"}>
                    {twr.alpha >= 0 ? "+" : ""}
                    {twr.alpha.toFixed(1)}% alpha
                  </Badge>
                  {twr.simulated && (
                    <Badge tone="neutral">
                      simulated benchmark
                    </Badge>
                  )}
                </div>
              }
            />
            <div className="px-3 pb-4">
              <div className="flex items-center gap-4 px-1 pb-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  <span className="text-xs text-ink-dim">
                    Portfolio{" "}
                    <span className="font-medium text-ink">{fmtPct(twr.portfolioTwr)}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  <span className="text-xs text-ink-dim">
                    {twr.name}{" "}
                    <span className="font-medium text-ink">{fmtPct(twr.benchmarkTwr)}</span>
                  </span>
                </div>
              </div>
              <TwrChart
                data={twr.rows}
                height={300}
                benchmarkName={twr.simulated ? "XEQT (sim.)" : "XEQT"}
              />
              {twr.note && (
                <p className="mt-2 text-center text-[11px] text-ink-faint">{twr.note}</p>
              )}
            </div>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader
              title="Gain / loss by position"
              subtitle="Total return including dividends (top 10)"
            />
            <div className="px-3 pb-4">
              {data.gainBars.length > 0 ? (
                <SignedHBars
                  data={data.gainBars as unknown as Record<string, unknown>[]}
                  labelKey="label"
                  valueKey="gain"
                  height={Math.max(220, data.gainBars.length * 34)}
                  fmt={(n) => fmtCompact(n)}
                />
              ) : (
                <p className="py-16 text-center text-xs text-ink-faint">No data yet.</p>
              )}
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Sector exposure" subtitle="Diversification snapshot" />
            <div className="px-3 pb-4">
              {data.sectors.length > 1 ? (
                <SectorRadar
                  data={data.sectors}
                  height={280}
                  fmt={(n) => fmtCompact(n)}
                />
              ) : (
                <p className="py-16 text-center text-xs text-ink-faint">
                  Add holdings in at least two sectors to compare.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Holdings table */}
        <Card>
          <CardHeader
            title="Holdings"
            subtitle="Click the pencil to update price or shares"
            action={
              data.closedCount > 0 ? (
                <Button variant="secondary" onClick={() => setShowClosed((v) => !v)}>
                  {showClosed
                    ? "Hide closed positions"
                    : `Show ${data.closedCount} closed position${data.closedCount === 1 ? "" : "s"}`}
                </Button>
              ) : undefined
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-faint">
                  <SortHeader label="Position" sortKey="name" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Shares" sortKey="shares" sort={sort} onSort={toggleSort} align="right" className="hidden md:table-cell" />
                  <SortHeader label="Avg cost" unit="(CAD)" sortKey="avgCostCAD" sort={sort} onSort={toggleSort} align="right" className="hidden md:table-cell" />
                  <SortHeader label="Price" unit="(CAD)" sortKey="priceCAD" sort={sort} onSort={toggleSort} align="right" />
                  <SortHeader label="Value" unit="(CAD)" sortKey="marketValue" sort={sort} onSort={toggleSort} align="right" />
                  <SortHeader label="Dividends" sortKey="totalDividends" sort={sort} onSort={toggleSort} align="right" className="hidden lg:table-cell" />
                  <SortHeader label="Gain" sortKey="totalReturn" sort={sort} onSort={toggleSort} align="right" />
                  <SortHeader label="MWRR" sortKey="mwrr" sort={sort} onSort={toggleSort} align="right" />
                  <SortHeader label="Weight" sortKey="weightPct" sort={sort} onSort={toggleSort} className="hidden xl:table-cell" />
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const pooled = r.lots.length > 1;
                  const open = expanded.has(r.ticker);
                  return (
                  <Fragment key={r.ticker}>
                  <tr
                    className={cn(
                      "border-b border-line/50 transition-colors last:border-0 hover:bg-elevated/60",
                      pooled && "cursor-pointer",
                      r.closed && "opacity-60",
                    )}
                    onClick={pooled ? () => toggleExpanded(r.ticker) : undefined}
                  >
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-elevated text-[9px] font-bold tracking-wide text-brand">
                          {r.ticker.slice(0, 3)}
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 font-semibold text-ink">
                            <span className="truncate">{r.name || r.ticker}</span>
                            {pooled && (
                              <ChevronRight
                                size={12}
                                className={cn(
                                  "shrink-0 text-ink-faint transition-transform",
                                  open && "rotate-90",
                                )}
                              />
                            )}
                          </span>
                          <span className="flex items-center gap-1 text-ink-faint">
                            <span className="truncate max-w-[100px]">{r.ticker}</span>
                            {r.closed && (
                              <span
                                className="shrink-0 rounded bg-elevated px-1 py-px text-[8px] font-medium text-ink-faint"
                                title="Every share has been sold. Kept for the record of the realized gain and the dividends it paid."
                              >
                                CLOSED
                              </span>
                            )}
                            {/* One tag per account the security sits in. */}
                            {r.accountIds.map((id) => (
                              <span
                                key={id}
                                className="shrink-0 rounded bg-elevated px-1 py-px text-[8px] font-medium text-ink-faint"
                              >
                                {accountLabel(id)}
                              </span>
                            ))}
                            {staleTickers.has(r.ticker) && (
                              <span
                                className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[8px] font-medium text-amber-400"
                                title="Last known price — the daily EODHD limit is used up, this updates automatically after 00:00 GMT"
                              >
                                STALE
                              </span>
                            )}
                            {r.currency === "USD" && (
                              <span className="shrink-0 rounded bg-elevated px-1 py-px text-[8px] font-medium text-amber-400">
                                USD
                              </span>
                            )}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">
                      {r.shares.toLocaleString("en-US")}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums text-ink-dim md:table-cell">
                      {fmtCAD(r.avgCostCAD, 2)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtCAD(r.priceCAD, 2)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                      {fmtCAD(r.marketValue)}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums text-ink-dim lg:table-cell">
                      {r.totalDividends > 0 ? (
                        <span className="text-positive">{fmtCAD(r.totalDividends)}</span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td
                      className={
                        "px-3 py-2.5 text-right tabular-nums font-medium " +
                        (r.totalReturn >= 0 ? "text-positive" : "text-negative")
                      }
                    >
                      {fmtSignedCAD(r.totalReturn)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums font-medium",
                        r.mwrr === null
                          ? "text-ink-faint"
                          : r.mwrr >= 0
                            ? "text-positive"
                            : "text-negative",
                      )}
                    >
                      {/* A dash, not a zero: no trade history means the return
                          is unknown, which is not the same as no return. */}
                      {r.mwrr === null ? (
                        <span title="No trade history for this position — import trades or log them to measure a return">
                          —
                        </span>
                      ) : (
                        fmtPct(r.mwrr)
                      )}
                    </td>
                    <td className="hidden px-3 py-2.5 xl:table-cell">
                      <div className="flex items-center gap-2">
                        <Progress value={r.weightPct} max={100} className="w-20" />
                        <span className="w-10 text-right text-[11px] tabular-nums text-ink-faint">
                          {r.weightPct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {/*
                        * Editing is per position, not per security: a pooled row
                        * has a separate cost basis in each account, so there is
                        * nothing coherent to edit at this level. Expand instead.
                        */}
                      {pooled ? (
                        <span className="text-[11px] text-ink-faint">
                          {r.lots.length} accounts
                        </span>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${r.ticker}`}
                            onClick={() => {
                              setEditing(r.lots[0]);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil size={14} />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                  {pooled &&
                    open &&
                    r.lots.map((lot) => (
                      <tr key={lot.id} className="border-b border-line/50 bg-elevated/30 last:border-0">
                        <td className="py-2 pl-12 pr-3">
                          <span className="text-[11px] text-ink-dim">
                            {accountLabel(lot.accountId)}
                          </span>
                          {lot.shares <= 0 && (
                            <span className="ml-1 rounded bg-elevated px-1 py-px text-[8px] font-medium text-ink-faint">
                              CLOSED
                            </span>
                          )}
                        </td>
                        <td className="hidden px-3 py-2 text-right tabular-nums text-ink-dim md:table-cell">
                          {lot.shares.toLocaleString("en-US")}
                        </td>
                        <td className="hidden px-3 py-2 text-right tabular-nums text-ink-dim md:table-cell">
                          {fmtCAD(lot.avgCostCAD ?? lot.avgCost, 2)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-dim">
                          {fmtCAD(lot.priceCAD ?? lot.price, 2)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-dim">
                          {fmtCAD(lot.shares * (lot.priceCAD ?? lot.price))}
                        </td>
                        <td className="hidden px-3 py-2 lg:table-cell" />
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2" />
                        <td className="hidden px-3 py-2 xl:table-cell" />
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${r.ticker} in ${accountLabel(lot.accountId)}`}
                            onClick={() => {
                              setEditing(lot);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil size={14} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                  );
                })}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-xs text-ink-faint">
                      No holdings yet — add your first position above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Allocation legend colors reference */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-[11px] text-ink-faint">
          {data.allocation.map((a, i) => (
            <span key={a.name} className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              {a.name} {((a.value / Math.max(1, data.totalValue)) * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>

      <HoldingForm
        open={formOpen}
        initial={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
    </Shell>
  );
}
