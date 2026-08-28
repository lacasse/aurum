"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flame, Pencil, Plus, RefreshCw, Trash2, TrendingUp } from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Badge, Button, Card, CardHeader, Progress } from "@/components/ui";
import {
  DonutChart,
  PALETTE,
  SectorRadar,
  SeriesChart,
  SignedHBars,
  TwrChart,
} from "@/components/charts";
import { ConfirmDelete, HoldingForm, TradeEntry } from "@/components/forms";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import {
  allocationByClass,
  holdingRows,
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

export default function InvestmentsPage() {
  const ready = useReady();
  const holdings = useFinance((s) => s.holdings);
  const accounts = useFinance((s) => s.accounts);
  const deleteHolding = useFinance((s) => s.deleteHolding);
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
  const [deleting, setDeleting] = useState<Holding | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkData | null>(null);
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [staleTickers, setStaleTickers] = useState<Set<string>>(new Set());
  const [quota, setQuota] = useState<{
    used: number;
    limit: number;
    remaining: number;
    resetsAt: string;
  } | null>(null);
  const mountedRef = useRef(true);

  /* ---- live price polling ---- */
  const refreshPrices = useCallback(async () => {
    if (holdings.length === 0) return;
    setPriceRefreshing(true);
    try {
      const tickers = holdings.map((h) => h.ticker).join(",");
      const classes = holdings.map((h) => h.assetClass).join(",");
      const currencies = holdings.map((h) => h.currency).join(",");
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
    const rows = holdingRows(holdings);
    const series = portfolioSeries(holdings, 18);
    const allocation = allocationByClass(holdings).sort((a, b) => b.value - a.value);
    const sectors = sectorExposure(holdings);
    const totalValue = rows.reduce((s, r) => s + r.marketValue, 0);
    const totalCost = rows.reduce((s, r) => s + r.costBasis, 0);
    const totalDividends = rows.reduce((s, r) => s + r.totalDividends, 0);
    const best = [...rows].sort((a, b) => b.mwrr - a.mwrr)[0];
    const gainBars = rows
      .slice(0, 10)
      .map((r) => ({ label: r.holding.ticker, gain: r.totalReturn }))
      .sort((a, b) => b.gain - a.gain);
    return {
      rows,
      series,
      allocation,
      sectors,
      totalValue,
      totalCost,
      totalDividends,
      best,
      gainBars,
    };
  }, [holdings]);

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
            value={data.best ? data.best.holding.ticker : "—"}
            delta={data.best?.mwrr}
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
          <CardHeader title="Holdings" subtitle="Click the pencil to update price or shares" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-faint">
                  <th className="px-3 py-2.5 font-medium">Position</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">Shares</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">Avg cost <span className="text-muted font-normal text-[10px]">(CAD)</span></th>
                  <th className="px-3 py-2.5 text-right font-medium">Price <span className="text-muted font-normal text-[10px]">(CAD)</span></th>
                  <th className="px-3 py-2.5 text-right font-medium">Value <span className="text-muted font-normal text-[10px]">(CAD)</span></th>
                  <th className="hidden px-3 py-2.5 text-right font-medium lg:table-cell">Dividends</th>
                  <th className="px-3 py-2.5 text-right font-medium">Gain</th>
                  <th className="px-3 py-2.5 text-right font-medium">MWRR</th>
                  <th className="hidden px-3 py-2.5 font-medium xl:table-cell">Weight</th>
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.holding.id}
                    className="border-b border-line/50 transition-colors last:border-0 hover:bg-elevated/60"
                  >
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-elevated text-[9px] font-bold tracking-wide text-brand">
                          {r.holding.ticker.slice(0, 3)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">
                            {r.holding.ticker}
                          </span>
                          <span className="flex items-center gap-1 text-ink-faint">
                            <span className="truncate max-w-[100px]">{r.holding.name}</span>
                            <span className="shrink-0 rounded bg-elevated px-1 py-px text-[8px] font-medium text-ink-faint">
                              {accountLabel(r.holding.accountId)}
                            </span>
                            {staleTickers.has(r.holding.ticker) && (
                              <span
                                className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[8px] font-medium text-amber-400"
                                title="Last known price — the daily EODHD limit is used up, this updates automatically after 00:00 GMT"
                              >
                                STALE
                              </span>
                            )}
                            {r.holding.currency === "USD" && (
                              <span className="shrink-0 rounded bg-elevated px-1 py-px text-[8px] font-medium text-amber-400">
                                USD
                              </span>
                            )}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">
                      {r.holding.shares.toLocaleString("en-US")}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums text-ink-dim md:table-cell">
                      {fmtCAD(r.holding.avgCostCAD ?? r.holding.avgCost, 2)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtCAD(r.holding.priceCAD ?? r.holding.price, 2)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                      {fmtCAD(r.marketValue)}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums text-ink-dim lg:table-cell">
                      {r.holding.dividendsReceived > 0 ? (
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
                      className={
                        "px-3 py-2.5 text-right tabular-nums font-medium " +
                        (r.mwrr >= 0 ? "text-positive" : "text-negative")
                      }
                    >
                      {fmtPct(r.mwrr)}
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
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${r.holding.ticker}`}
                        onClick={() => {
                          setEditing(r.holding);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${r.holding.ticker}`}
                        onClick={() => setDeleting(r.holding)}
                        className="hover:text-negative"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
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
      <ConfirmDelete
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteHolding(deleting.id)}
        title="Delete holding"
        message={`Remove ${deleting?.ticker ?? ""} from your portfolio? This cannot be undone.`}
      />
    </Shell>
  );
}
