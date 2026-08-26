"use client";

import { useMemo, useState } from "react";
import { Flame, Pencil, Plus, Trash2, TrendingUp } from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Badge, Button, Card, CardHeader, Progress } from "@/components/ui";
import {
  DonutChart,
  PALETTE,
  SectorRadar,
  SeriesChart,
  SignedHBars,
} from "@/components/charts";
import { ConfirmDelete, HoldingForm } from "@/components/forms";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import {
  allocationByClass,
  holdingRows,
  portfolioSeries,
  sectorExposure,
} from "@/lib/analytics";
import { fmtCompact, fmtPct, fmtSignedUSD, fmtUSD } from "@/lib/format";
import type { Holding } from "@/lib/types";

export default function InvestmentsPage() {
  const ready = useReady();
  const holdings = useFinance((s) => s.holdings);
  const deleteHolding = useFinance((s) => s.deleteHolding);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Holding | null>(null);
  const [deleting, setDeleting] = useState<Holding | null>(null);

  const data = useMemo(() => {
    const rows = holdingRows(holdings);
    const series = portfolioSeries(holdings, 18);
    const allocation = allocationByClass(holdings).sort((a, b) => b.value - a.value);
    const sectors = sectorExposure(holdings);
    const totalValue = rows.reduce((s, r) => s + r.marketValue, 0);
    const totalCost = rows.reduce((s, r) => s + r.costBasis, 0);
    const best = [...rows].sort((a, b) => b.gainPct - a.gainPct)[0];
    const gainBars = rows
      .slice(0, 10)
      .map((r) => ({ label: r.holding.ticker, gain: r.gain }))
      .sort((a, b) => b.gain - a.gain);
    return {
      rows,
      series,
      allocation,
      sectors,
      totalValue,
      totalCost,
      best,
      gainBars,
    };
  }, [holdings]);

  if (!ready) return <PageSkeleton />;

  const last = data.series[data.series.length - 1];
  const prev = data.series[data.series.length - 2] ?? last;
  const monthDelta = prev.value !== 0 ? ((last.value - prev.value) / prev.value) * 100 : 0;
  const unrealized = data.totalValue - data.totalCost;
  const unrealizedPct =
    data.totalCost > 0 ? (unrealized / data.totalCost) * 100 : 0;

  return (
    <Shell
      title="Investments"
      subtitle={`${holdings.length} holdings · values are manually tracked`}
      action={
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus size={15} /> Add holding
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Portfolio value"
            value={fmtUSD(data.totalValue)}
            delta={monthDelta}
            deltaLabel="vs last month"
            icon={<TrendingUp size={16} />}
            spark={data.series.map((p) => ({ v: p.value }))}
            sparkKey="v"
            sparkColor="#22d3ee"
          />
          <StatCard
            label="Cost basis"
            value={fmtUSD(data.totalCost)}
            deltaLabel={`across ${data.rows.length} positions`}
            icon={<Flame size={16} />}
          />
          <StatCard
            label="Unrealized gain"
            value={fmtSignedUSD(unrealized)}
            delta={unrealizedPct}
            deltaLabel="of cost basis"
            tone={unrealized >= 0 ? "positive" : "negative"}
          />
          <StatCard
            label="Best performer"
            value={data.best ? data.best.holding.ticker : "—"}
            delta={data.best?.gainPct}
            deltaLabel={data.best ? fmtSignedUSD(data.best.gain) : "no holdings yet"}
            tone="positive"
          />
        </div>

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
                  fmt={(n) => fmtUSD(n)}
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

        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader
              title="Gain / loss by position"
              subtitle="Unrealized profit per holding (top 10)"
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
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                  <th className="px-4 py-3 font-medium">Position</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Class</th>
                  <th className="px-4 py-3 text-right font-medium">Shares</th>
                  <th className="hidden px-4 py-3 text-right font-medium md:table-cell">
                    Avg cost
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">Value</th>
                  <th className="px-4 py-3 text-right font-medium">Gain</th>
                  <th className="hidden px-4 py-3 font-medium xl:table-cell">Weight</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.holding.id}
                    className="border-b border-line/50 transition-colors last:border-0 hover:bg-elevated/60"
                  >
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated text-[10px] font-bold tracking-wide text-brand">
                          {r.holding.ticker.slice(0, 3)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">
                            {r.holding.ticker}
                          </span>
                          <span className="block max-w-[180px] truncate text-[11px] text-ink-faint">
                            {r.holding.name}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <Badge>{r.holding.assetClass}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.holding.shares.toLocaleString("en-US")}
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums text-ink-dim md:table-cell">
                      {fmtUSD(r.holding.avgCost, 2)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtUSD(r.holding.price, 2)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {fmtUSD(r.marketValue)}
                    </td>
                    <td
                      className={
                        "px-4 py-3 text-right tabular-nums font-medium " +
                        (r.gain >= 0 ? "text-positive" : "text-negative")
                      }
                    >
                      {fmtSignedUSD(r.gain)}
                      <span className="ml-1 text-[11px] opacity-80">
                        {fmtPct(r.gainPct)}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 xl:table-cell">
                      <div className="flex items-center gap-2">
                        <Progress value={r.weightPct} max={100} className="w-20" />
                        <span className="w-10 text-right text-[11px] tabular-nums text-ink-faint">
                          {r.weightPct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
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
                    <td colSpan={9} className="py-12 text-center text-xs text-ink-faint">
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
