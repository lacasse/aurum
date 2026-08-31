"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Flame,
  Pencil,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  Progress,
  Segmented,
  cn,
} from "@/components/ui";
import {
  DonutChart,
  ExposurePie,
  SeriesChart,
  SignedHBars,
  TwrChart,
} from "@/components/charts";
import { HoldingForm, TradeEntry } from "@/components/forms";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import type { HoldingRow, SortKey } from "@/lib/analytics";
import {
  allTimeSeries,
  allocationByClass,
  chainedReturns,
  firstFlowMonth,
  netExternalFlows,
  annualized,
  holdingRows,
  monthsSince,
  portfolioMwrr,
  sortHoldingRows,
  simpleReturn,
  portfolioSeries,
  holdingExposure,
  type SnapshotHistory,
} from "@/lib/analytics";
import {
  fmtCompact,
  fmtPct,
  fmtSignedCAD,
  fmtCAD,
  labelDate,
  labelMonth,
  currentMonthKey,
} from "@/lib/format";
import type { Holding } from "@/lib/types";
import { awaitingPrice, priceReward } from "@/lib/rewards";
import { drift } from "@/lib/allocation";
import { replayFlows } from "@/lib/analytics";

const POLL_MS = 60 * 60_000;

/*
 * Windows the growth and return charts can be read over.
 *
 * "All" is every month since the first recorded trade — not a fixed span. The
 * series behind it replays the trades and prices each month at its own close,
 * so it is the portfolio as it actually stood, back to the day it started.
 */
const RANGE_MONTHS = { "3M": 3, "6M": 6, "1Y": 12, "3Y": 36, ALL: Infinity } as const;

type RangeKey = keyof typeof RANGE_MONTHS;

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
  { value: "3Y", label: "3Y" },
  { value: "ALL", label: "All" },
];

/** Keep the last `n` entries; `Infinity` keeps them all. */
function windowed<T>(rows: T[], range: RangeKey): T[] {
  const n = RANGE_MONTHS[range];
  return Number.isFinite(n) ? rows.slice(-n) : rows;
}

/** "since Feb ’22" for the full run, "last 6 months" for a window of it. */
function rangeLabel(range: RangeKey, points: { label: string }[]): string {
  if (range !== "ALL") return `last ${points.length} months`;
  return points.length > 0 ? `since ${points[0].label}` : "all time";
}

interface BenchmarkData {
  name: string;
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

/**
 * Rewards that arrived without a value, waiting for one.
 *
 * Left alone they are units with no cost, which quietly turns their whole
 * eventual sale into a capital gain and leaves the income they were never
 * recorded as. So they are listed until someone types what a unit was worth
 * on the day it landed — the one figure the app cannot work out for itself,
 * since it fetches today's price and nothing else.
 */
function PendingRewards() {
  const holdings = useFinance((s) => s.holdings);
  const updateHolding = useFinance((s) => s.updateHolding);
  const usdCadRate = useFinance((s) => s.usdCadRate);
  const [values, setValues] = useState<Record<string, string>>({});
  const pending = useMemo(() => awaitingPrice(holdings), [holdings]);
  if (pending.length === 0) return null;

  const keyOf = (r: (typeof pending)[number]) =>
    `${r.holdingId}|${r.date}|${r.units}`;

  const apply = (r: (typeof pending)[number]) => {
    const perUnit = Number(values[keyOf(r)]);
    if (!Number.isFinite(perUnit) || perUnit <= 0) return;
    const holding = holdings.find((h) => h.id === r.holdingId);
    if (!holding) return;
    const flows = priceReward(holding.flows, r.date, r.units, perUnit * r.units);
    // Cost and income both follow from the flows, so they are replayed rather
    // than adjusted: the same arithmetic that reports them everywhere else.
    const { costCAD, shares, dividendsCAD } = replayFlows(flows);
    /*
     * Flows are in Canadian dollars and `avgCost` is in the listing currency,
     * so a US-listed position converts back on the way in — the store derives
     * the CAD mirror from this figure, and handing it a CAD number for a USD
     * holding would multiply the cost base by the exchange rate.
     */
    const toListing = (cad: number) =>
      holding.currency === "USD" && usdCadRate > 0 ? cad / usdCadRate : cad;
    updateHolding(holding.id, {
      ...holding,
      flows,
      avgCost:
        shares > 0 ? Math.round(toListing(costCAD / shares) * 10000) / 10000 : 0,
      dividendsReceived: Math.round(toListing(dividendsCAD) * 100) / 100,
    });
  };

  return (
    <Card className="border-amber-500/40 bg-amber-500/5 p-4">
      <p className="text-sm font-medium text-amber-400">
        {pending.length} staking reward{pending.length === 1 ? "" : "s"} without
        a value
      </p>
      <p className="mt-1 text-xs text-ink-dim">
        These units were recorded as arriving for nothing, so their whole value
        counts as a gain when sold and none of it as income. Enter what one unit
        was worth in Canadian dollars on the day it landed.
      </p>
      <ul className="mt-3 space-y-2">
        {pending.map((r) => (
          <li key={keyOf(r)} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="tabular-nums text-ink-dim">{labelDate(r.date)}</span>
            <span className="font-medium">
              {r.units} {r.ticker}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <Input
                type="number"
                step="any"
                min="0"
                className="w-28"
                placeholder="CAD each"
                value={values[keyOf(r)] ?? ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setValues((prev) => ({ ...prev, [keyOf(r)]: e.target.value }))
                }
              />
              <Button size="sm" variant="secondary" onClick={() => apply(r)}>
                Record
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * What the portfolio is against what it is meant to be.
 *
 * Targets are per security and kept as one small map, because that is the
 * question actually being asked: two funds in the same class can be one you
 * are building and one you are leaving. The drift is shown in money as well as
 * in points — "eight points over" is a judgement, "$38,000 over" is an
 * instruction.
 */
function TargetAllocation({ rows }: { rows: HoldingRow[] }) {
  const [targets, setTargets] = useState<Record<string, number> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/targets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { targets: Record<string, number> }) => {
        if (!cancelled) setTargets(d.targets ?? {});
      })
      .catch(() => {
        if (!cancelled) setTargets({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useMemo(() => rows.filter((r) => !r.closed), [rows]);
  const result = useMemo(
    () =>
      drift(
        open.map((r) => ({ ticker: r.ticker, name: r.name, marketValue: r.marketValue })),
        targets ?? {},
      ),
    [open, targets],
  );

  if (targets === null) return null;

  const startEditing = () => {
    const next: Record<string, string> = {};
    for (const r of result.rows) {
      next[r.ticker] = r.targetPct === null ? "" : String(r.targetPct);
    }
    setDraft(next);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    const next: Record<string, number> = {};
    // A box left empty removes the target rather than setting it to zero:
    // "no plan for this" and "hold none of this" are different answers.
    for (const [ticker, raw] of Object.entries(draft)) {
      if (raw.trim() === "") continue;
      const pct = Number(raw);
      if (Number.isFinite(pct) && pct >= 0 && pct <= 100) next[ticker.toUpperCase()] = pct;
    }
    try {
      const res = await fetch("/api/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: next }),
      });
      const body: { targets?: Record<string, number> } = await res.json();
      setTargets(body.targets ?? next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const noTargets = Object.keys(targets).length === 0;

  return (
    <Card>
      <CardHeader
        title="Target allocation"
        subtitle={
          noTargets
            ? "Set a share for each position and this will show how far off it has drifted"
            : `Targets total ${result.targetTotal.toFixed(0)}%${
                result.untargeted > 0
                  ? ` · ${result.untargeted} position${result.untargeted === 1 ? "" : "s"} with no target`
                  : ""
              }`
        }
        action={
          editing ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save targets"}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={startEditing}>
              {noTargets ? "Set targets" : "Edit targets"}
            </Button>
          )
        }
      />
      <div className="overflow-x-auto px-2 pb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-ink-faint">
              <th className="px-3 py-2 text-left font-medium">Security</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
              <th className="px-3 py-2 text-right font-medium">Actual</th>
              <th className="px-3 py-2 text-right font-medium">Target</th>
              <th className="px-3 py-2 text-right font-medium">Drift</th>
              <th className="px-3 py-2 text-right font-medium">To rebalance</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.ticker} className="border-t border-line/60">
                <td className="px-3 py-2.5">
                  <span className="font-medium">{r.ticker}</span>
                  <span className="ml-2 text-[11px] text-ink-faint">{r.name}</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-dim">
                  {fmtCAD(r.value)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {r.actualPct.toFixed(1)}%
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {editing ? (
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      className="ml-auto w-20 text-right"
                      placeholder="—"
                      value={draft[r.ticker] ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setDraft((prev) => ({ ...prev, [r.ticker]: e.target.value }))
                      }
                    />
                  ) : r.targetPct === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    `${r.targetPct.toFixed(1)}%`
                  )}
                </td>
                <td
                  className={cn(
                    "px-3 py-2.5 text-right tabular-nums",
                    r.driftPct === null
                      ? "text-ink-faint"
                      : Math.abs(r.driftPct) < 1
                        ? "text-ink-dim"
                        : r.driftPct > 0
                          ? "text-amber-500"
                          : "text-brand",
                  )}
                >
                  {r.driftPct === null
                    ? "—"
                    : `${r.driftPct > 0 ? "+" : ""}${r.driftPct.toFixed(1)} pts`}
                </td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                  {r.driftValue === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    <span className={r.driftValue > 0 ? "text-amber-500" : "text-brand"}>
                      {r.driftValue > 0 ? "sell " : "buy "}
                      {fmtCAD(Math.abs(r.driftValue))}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!noTargets && result.targetTotal !== 100 && (
        <p className="px-5 pb-4 text-xs text-ink-faint">
          The targets add up to {result.targetTotal.toFixed(1)}%, not 100%. Every
          drift is measured against the portfolio as it stands, so the figures
          still hold — but a plan that does not add to all of it is missing a
          piece.
        </p>
      )}
    </Card>
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
  const [growthRange, setGrowthRange] = useState<RangeKey>("ALL");
  const [twrRange, setTwrRange] = useState<RangeKey>("ALL");
  const [snapshots, setSnapshots] = useState<SnapshotHistory>({});

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
  /*
   * Whether the closed positions have been priced this session. They are not
   * polled — see below — so this is what stops opening and shutting the section
   * from re-spending the allowance each time.
   */
  const closedPricedRef = useRef(false);

  /* ---- live price polling ---- */

  /**
   * Fetch prices for a set of holdings and write back the ones that moved.
   *
   * One request per security, not per position: the same ticker held in four
   * accounts asked for four prices before, which spent four calls out of a
   * strictly limited daily allowance to learn one number.
   */
  const fetchPricesFor = useCallback(
    async (subset: Holding[], { replaceStale }: { replaceStale: boolean }) => {
      const priceable = new Map<string, { assetClass: string; currency: string }>();
      for (const h of subset) {
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
        setStaleTickers((prev) =>
          replaceStale
            ? new Set(stale ?? [])
            : // A closed-position fetch covers only part of the portfolio, so
              // its answer adds to what the poll found rather than replacing it.
              new Set([...prev, ...(stale ?? [])]),
        );
        setQuota(q ?? null);
        for (const h of subset) {
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
    },
    [updateHolding],
  );

  /*
   * The poll covers open positions only. A sold-off holding's price changes
   * nothing — its realized gain is already settled by what it sold for — so
   * polling it every few minutes spends a scarce daily allowance to keep a
   * number nobody is looking at up to date.
   */
  const refreshPrices = useCallback(
    () => fetchPricesFor(holdings.filter((h) => h.shares > 0), { replaceStale: true }),
    [holdings, fetchPricesFor],
  );

  useEffect(() => {
    mountedRef.current = true;
    /*
     * Nothing is priced until the server's holdings have landed. The store
     * starts on the bundled sample portfolio, and this effect runs before the
     * skeleton gives way to the page — so without the guard the first poll
     * asked the provider to quote VTI, AAPL and the rest of the demo data,
     * spending a strictly limited daily allowance on securities nobody owns.
     */
    if (!ready) {
      return () => {
        mountedRef.current = false;
      };
    }
    // Defer initial fetch to avoid setState synchronously in effect body
    const timer = setTimeout(refreshPrices, 0);
    const id = setInterval(refreshPrices, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
      clearInterval(id);
    };
  }, [ready, refreshPrices]);

  /*
   * Closed positions are priced once, the first time their section is opened.
   *
   * They are worth a current price when you are looking at them — a sold-off
   * row still shows a market value — but not one refreshed on a timer while
   * hidden. Once per session, on demand, is the whole cost.
   */
  useEffect(() => {
    if (!showClosed || closedPricedRef.current) return;
    const closed = holdings.filter((h) => h.shares <= 0);
    if (closed.length === 0) return;
    closedPricedRef.current = true;
    // Deferred for the same reason as the initial poll: calling straight
    // through would set state synchronously in the effect body.
    const timer = setTimeout(() => void fetchPricesFor(closed, { replaceStale: false }), 0);
    return () => clearTimeout(timer);
  }, [showClosed, holdings, fetchPricesFor]);

  /*
   * Recorded month-end values — the best source there is for what the
   * portfolio was worth, and the only one that reaches months with no trade
   * behind them. Fetched once: it is history, and history does not move.
   */
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch("/api/snapshots/history", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { months: SnapshotHistory }) => {
          if (!cancelled) setSnapshots(d.months ?? {});
        })
        .catch(() => {});
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  /*
   * How far back the charts can go: the earlier of the first recorded trade
   * and the first recorded month-end value. The values reach further back —
   * positions were held before the trade log was kept — and a chart that
   * started at the first trade would simply omit them.
   * The benchmark is asked for the same span so the two lines start together.
   */
  const historyStart = useMemo(() => {
    const flow = firstFlowMonth(holdings);
    const recorded = Object.keys(snapshots).sort()[0];
    if (!flow) return recorded ?? null;
    if (!recorded) return flow;
    return recorded < flow ? recorded : flow;
  }, [holdings, snapshots]);

  const spanMonths = useMemo(
    () => (historyStart ? monthsSince(historyStart).length : 18),
    [historyStart],
  );

  /* ---- benchmark ---- */
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/benchmark?months=${spanMonths}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: BenchmarkData) => {
        if (!cancelled) setBenchmark(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [spanMonths]);

  const data = useMemo(() => {
    const all = sortHoldingRows(holdingRows(holdings), sort.key, sort.dir);
    const closedCount = all.filter((r) => r.closed).length;
    const rows = showClosed ? all : all.filter((r) => !r.closed);
    // Derived figures describe the live portfolio, so a closed position never
    // becomes the "best performer" on the strength of old dividends.
    const open = all.filter((r) => !r.closed);
    const series = portfolioSeries(holdings, 18);
    const allocation = allocationByClass(holdings).sort((a, b) => b.value - a.value);
    const exposure = holdingExposure(holdings);
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
      exposure,
      totalValue,
      totalCost,
      totalDividends,
      best,
      gainBars,
    };
  }, [holdings, sort, showClosed]);

  /*
   * The whole run is computed once; the window only trims what is drawn, so
   * switching ranges is a change of view rather than of data and never
   * refetches. Until the recorded values arrive this falls back to the
   * eighteen months of prices carried on the holdings themselves, so the
   * chart is never empty.
   */
  const allTime = useMemo(() => {
    if (!historyStart || Object.keys(snapshots).length === 0) return null;
    return allTimeSeries(holdings, {}, monthsSince(historyStart), snapshots);
  }, [holdings, snapshots, historyStart]);

  const fullSeries = allTime?.points ?? data.series;

  const growthSeries = useMemo(
    () => windowed(fullSeries, growthRange),
    [fullSeries, growthRange],
  );

  const flowsByMonth = useMemo(() => netExternalFlows(holdings), [holdings]);

  /*
   * The three returns, always over the whole record rather than the chart's
   * window. They are here to be read against each other, and a range selector
   * would only invite the question of which of them it applied to.
   */
  const returns = useMemo(() => {
    const simple = simpleReturn(holdings, data.totalValue);
    const mwrr = portfolioMwrr(holdings, data.totalValue);
    /*
     * The month in progress is left out of the time-weighted figure. Its value
     * is today's, not a month-end's, so treating it as a completed monthly
     * return states a fraction of a month as a whole one — three weeks of a
     * good August took the all-time figure from 33% to 64%. It also put the
     * card at odds with the chart below, which stops at the last month the
     * benchmark has a close for. Both now measure completed months.
     */
    const complete =
      fullSeries.length > 1 &&
      fullSeries[fullSeries.length - 1].key === currentMonthKey()
        ? fullSeries.slice(0, -1)
        : fullSeries;
    const span = complete.length - 1;
    const chained = chainedReturns(complete, flowsByMonth);
    const twrTotal = chained[chained.length - 1] ?? null;
    const twrAnnual = twrTotal === null ? null : annualized(twrTotal, span);
    return {
      simple,
      mwrr,
      twrTotal,
      twrAnnual,
      months: span,
      through: complete[complete.length - 1]?.label ?? "",
      from: fullSeries[0]?.label ?? "",
      gap: mwrr !== null && twrAnnual !== null ? mwrr - twrAnnual : null,
    };
  }, [holdings, data.totalValue, fullSeries, flowsByMonth]);

  const twr = useMemo(() => {
    if (!benchmark || benchmark.series.length < 2) return null;
    const valueByMonth = new Map(fullSeries.map((p) => [p.key, p.value]));
    const priceByMonth = new Map(benchmark.series.map((p) => [p.month, p.price]));
    /*
     * Rebased to the first month of the window, not to the first month on
     * record. A time-weighted return over the last quarter has to start the
     * quarter at zero, otherwise the chart answers the all-time question on a
     * shorter x-axis.
     *
     * Months before the first holding was bought are dropped: dividing by a
     * portfolio worth nothing is not a return, it is an infinity.
     */
    const months = benchmark.series
      .map((p) => p.month)
      .filter((m) => valueByMonth.has(m) && valueByMonth.get(m)! > 0);
    const windowedMonths = windowed(months, twrRange);
    if (windowedMonths.length < 2) return null;
    const b0 = priceByMonth.get(windowedMonths[0])!;
    if (!b0) return null;
    /*
     * The portfolio line is chained monthly returns, not the ratio of its
     * first value to its last: deposits are not performance. The benchmark
     * needs no such treatment — an index price has no cash flows — so it stays
     * a simple ratio, and the two are finally measuring the same thing.
     */
    const windowPoints = windowedMonths.map((m) => ({
      key: m,
      label: labelMonth(m),
      value: valueByMonth.get(m)!,
      cost: 0,
    }));
    const growth = chainedReturns(windowPoints, flowsByMonth);
    const rows = windowedMonths.map((m, i) => ({
      key: m,
      label: labelMonth(m),
      portfolio: growth[i],
      benchmark: (priceByMonth.get(m)! / b0 - 1) * 100,
    }));
    const finalRow = rows[rows.length - 1];

    return {
      rows: rows as unknown as Record<string, unknown>[],
      portfolioTwr: finalRow.portfolio,
      benchmarkTwr: finalRow.benchmark,
      alpha: finalRow.portfolio - finalRow.benchmark,
      // Intervals, not points: n months of prices give n-1 monthly returns,
      // and this is the same count the returns card above reports.
      months: windowedMonths.length - 1,
      name: benchmark.name,
      note: benchmark.note,
    };
  }, [benchmark, fullSeries, flowsByMonth, twrRange]);

  if (!ready) return <PageSkeleton />;

  const last = data.series[data.series.length - 1];
  const prev = data.series[data.series.length - 2] ?? last;
  const monthDelta = prev.value !== 0 ? ((last.value - prev.value) / prev.value) * 100 : 0;
  const monthDeltaCAD = last.value - prev.value;
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
              {/*
                * The daily cap is named only when it is actually the cause.
                * Staleness now covers both providers, and a Twelve Data ticker
                * that failed to quote has nothing to do with the EODHD
                * allowance — saying so would send you looking in the wrong
                * place, or waiting for a reset that changes nothing.
                */}
              {quota && quota.remaining === 0
                ? `The EODHD free plan allows ${quota.limit} price lookups a day and all ${quota.used} have been used; they reset at ${new Date(quota.resetsAt).toLocaleString()}. `
                : "They update on the next successful refresh. "}
            </p>
          </Card>
        )}
        <PendingRewards />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Portfolio value"
            value={fmtCAD(data.totalValue)}
            delta={monthDelta}
            deltaValue={fmtSignedCAD(monthDeltaCAD)}
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

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Portfolio growth"
              subtitle={`Market value vs invested cost · ${rangeLabel(growthRange, growthSeries)}`}
              action={
                <Segmented
                  options={RANGE_OPTIONS}
                  value={growthRange}
                  onChange={setGrowthRange}
                />
              }
            />
            <div className="px-3 pb-4">
              <SeriesChart
                data={growthSeries as unknown as Record<string, unknown>[]}
                xKey="label"
                series={[
                  { key: "value", name: "Market value", color: "#22d3ee" },
                  { key: "cost", name: "Cost basis", color: "#6e6e79", kind: "line", dashed: true },
                ]}
                height={300}
                yFmt={fmtCompact}
              />
              {allTime && allTime.unpriced.length > 0 && (
                <p className="mt-2 text-center text-[11px] text-ink-faint">
                  No price history for {allTime.unpriced.join(", ")} — valued at
                  book cost for the months held.
                </p>
              )}
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

        <Card>
          <CardHeader
            title="Three ways of asking how it went"
            subtitle={`Since ${returns.from} · the same portfolio, measured three ways`}
          />
          <div className="grid gap-px bg-line sm:grid-cols-3">
            <div className="bg-surface p-5">
              <p className="text-xs uppercase tracking-wider text-ink-faint">Simple return</p>
              <p
                className={cn(
                  "mt-1 text-2xl font-semibold tabular-nums",
                  (returns.simple.pct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400",
                )}
              >
                {returns.simple.pct === null ? "—" : fmtPct(returns.simple.pct)}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-dim">
                Everything you put in against everything you got back and still hold.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                {fmtCAD(returns.simple.contributed)} in · {fmtCAD(returns.simple.returned)}{" "}
                back · {fmtCAD(returns.simple.held)} held. It ignores time entirely, so the
                same figure could be one good year or five slow ones.
              </p>
            </div>

            <div className="bg-surface p-5">
              <p className="text-xs uppercase tracking-wider text-ink-faint">
                Money-weighted · MWRR
              </p>
              <p
                className={cn(
                  "mt-1 text-2xl font-semibold tabular-nums",
                  (returns.mwrr ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400",
                )}
              >
                {returns.mwrr === null ? "—" : `${fmtPct(returns.mwrr)}/yr`}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-dim">
                What your actual dollars earned, counting when each one arrived.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                Money added just before a fall drags this down; money added before a rise
                lifts it. This is your return, and it is the one you cannot compare to an
                index — the index never had your deposits.
              </p>
            </div>

            <div className="bg-surface p-5">
              <p className="text-xs uppercase tracking-wider text-ink-faint">
                Time-weighted · TWRR
              </p>
              <p
                className={cn(
                  "mt-1 text-2xl font-semibold tabular-nums",
                  (returns.twrAnnual ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400",
                )}
              >
                {returns.twrAnnual === null ? "—" : `${fmtPct(returns.twrAnnual)}/yr`}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-dim">
                How the holdings performed, with deposits and withdrawals removed.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                {returns.twrTotal === null
                  ? ""
                  : `${fmtPct(returns.twrTotal)} in total over ${returns.months} months, through ${returns.through}. `}
                Because it ignores when money moved, it judges what you bought rather than
                when you bought it — which is why it is the one set against XEQT below.
              </p>
            </div>
          </div>

          {returns.gap !== null && (
            <div className="border-t border-line px-5 py-4">
              <p className="text-xs leading-relaxed text-ink-dim">
                <span className="font-medium text-ink">Why they differ.</span>{" "}
                {Math.abs(returns.gap) < 1 ? (
                  <>
                    Your money and your holdings returned about the same, which means the
                    timing of your contributions made little difference either way.
                  </>
                ) : returns.gap < 0 ? (
                  <>
                    The holdings earned{" "}
                    <span className="font-medium text-ink">
                      {fmtPct(returns.twrAnnual!)}/yr
                    </span>{" "}
                    while your money earned{" "}
                    <span className="font-medium text-rose-400">
                      {fmtPct(returns.mwrr!)}/yr
                    </span>
                    , a gap of {Math.abs(returns.gap).toFixed(1)} points. More was invested
                    before the falls than before the rises: the choices did better than the
                    timing.
                  </>
                ) : (
                  <>
                    Your money earned{" "}
                    <span className="font-medium text-emerald-400">
                      {fmtPct(returns.mwrr!)}/yr
                    </span>{" "}
                    against the holdings&rsquo;{" "}
                    <span className="font-medium text-ink">
                      {fmtPct(returns.twrAnnual!)}/yr
                    </span>
                    , a gap of {returns.gap.toFixed(1)} points in your favour — you tended to
                    add money before the rises.
                  </>
                )}
              </p>
            </div>
          )}
        </Card>

        {twr && (
          <Card>
            <CardHeader
              title="Time-weighted return vs XEQT"
              subtitle={`Chained monthly returns over ${twr.months} months · deposits and withdrawals removed`}
              action={
                <div className="flex items-center gap-2">
                  <Segmented
                    options={RANGE_OPTIONS}
                    value={twrRange}
                    onChange={setTwrRange}
                  />
                  <Badge tone={twr.alpha >= 0 ? "positive" : "negative"}>
                    {twr.alpha >= 0 ? "+" : ""}
                    {twr.alpha.toFixed(1)}% alpha
                  </Badge>
                </div>
              }
            />
            <div className="px-3 pb-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-2">
                <span className="flex items-center gap-2 text-xs text-ink-dim">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  Portfolio{" "}
                  <span className="font-medium text-ink">{fmtPct(twr.portfolioTwr)}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-ink-dim">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  {twr.name}{" "}
                  <span className="font-medium text-ink">{fmtPct(twr.benchmarkTwr)}</span>
                </span>
              </div>
              <TwrChart data={twr.rows} height={300} benchmarkName="XEQT" />
            </div>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
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

          <Card>
            <CardHeader
              title="Holdings exposure"
              subtitle="Every position, shaded by asset class"
            />
            <div className="px-3 pb-4">
              {data.exposure.length > 0 ? (
                <ExposurePie
                  data={data.exposure}
                  height={260}
                  fmt={(n) => fmtCompact(n)}
                />
              ) : (
                <p className="py-16 text-center text-xs text-ink-faint">
                  Add a holding to see the breakdown.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Holdings table */}
        <TargetAllocation rows={data.rows} />

        <Card>
          <CardHeader
            title="Holdings"
            subtitle="Click the pencil to rename a holding or change its asset class"
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
                  /*
                   * A security held in several accounts keeps its sold-off lots
                   * out of the breakdown on the same terms as the table itself:
                   * hidden by default, shown when closed positions are shown.
                   * The row's own totals still count them — a realized gain
                   * pooled across accounts is the point of pooling — so this
                   * hides the line, never the money.
                   */
                  const lots = showClosed ? r.lots : r.lots.filter((l) => l.shares > 0);
                  // Counted after the filter, so a position left in one account
                  // reads and behaves as the single holding it now is.
                  const pooled = lots.length > 1;
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
                              /* Not amber: that is what STALE uses, and a
                                 listing currency is a fact about the security,
                                 not a warning about its price. */
                              <span className="shrink-0 rounded bg-info/15 px-1 py-px text-[8px] font-medium text-info">
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
                        * The pencil edits the security — ticker, name, asset
                        * class — which is the same in every account holding it,
                        * so a pooled row can be edited from here directly and
                        * the change reaches all of its lots.
                        */}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${r.ticker}`}
                        onClick={() => {
                          setEditing(lots[0]);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil size={14} />
                      </Button>
                    </td>
                  </tr>
                  {pooled &&
                    open &&
                    lots.map((lot) => (
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
                        {/*
                          * No pencil per account. Everything the form edits is
                          * a property of the security and saves to every
                          * account at once, so a pencil here would promise a
                          * per-account edit that does not exist.
                          */}
                        <td className="px-3 py-2" />
                      </tr>
                    ))}
                  </Fragment>
                  );
                })}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-xs text-ink-faint">
                      No holdings yet — log your first trade below.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Batch trade entry */}
        <Card>
          <CardHeader
            title="Log trades"
            subtitle="Record buys, sells, and dividends. A ticker you have never held asks for its details on submit."
          />
          <div className="px-3 pb-4">
            <TradeEntry onComplete={() => {}} />
          </div>
        </Card>
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
