"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Coins,
  LineChart,
  PiggyBank,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Badge, Button, Card, CardHeader, Segmented, cn } from "@/components/ui";
import {
  DonutChart,
  GroupedBars,
  PALETTE,
  SeriesChart,
} from "@/components/charts";
import { TransactionForm } from "@/components/forms";
import { MonthlyChecklistButton, MonthlyChecklistModal } from "@/components/monthly-checklist";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import {
  cashflowSeries,
  consolidateHoldings,
  monthlyAverages,
  monthTotals,
  netWorthSeries,
  portfolioSeries,
  spendByCategory,
  stackedSpend,
} from "@/lib/analytics";
import {
  fmtCompact,
  fmtPct,
  fmtSignedCAD,
  fmtCAD,
  labelDate,
} from "@/lib/format";
import { ACCOUNT_KIND_LABELS, primaryAccountId } from "@/lib/types";

type Range = "6" | "12" | "18";

export default function DashboardPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const holdings = useFinance((s) => s.holdings);
  const [range, setRange] = useState<Range>("12");
  const [addOpen, setAddOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);

  const data = useMemo(() => {
    const nwAll = netWorthSeries(accounts, holdings, 18);
    const nw = nwAll.slice(-Number(range));
    const cf = cashflowSeries(transactions, 12);
    const totals = monthTotals(transactions);
    const spend = spendByCategory(transactions, cf[cf.length - 1]?.key);
    const topCats = spendByCategory(transactions)
      .slice(0, 5)
      .map((c) => c.name);
    const stacked = stackedSpend(
      transactions,
      topCats,
      12,
    ) as unknown as Record<string, unknown>[];
    const port = portfolioSeries(holdings, 18);
    const avg = monthlyAverages(transactions, 12);
    /*
     * What net worth is made of. The portfolio is the largest part of it and
     * moves on its own, so the top row breaks it out rather than leaving one
     * number to stand for everything.
     */
    const rows = consolidateHoldings(holdings).filter((r) => !r.closed);
    const invested = rows.reduce((sum, r) => sum + r.costBasis, 0);
    const market = rows.reduce((sum, r) => sum + r.marketValue, 0);
    const dividends = rows.reduce((sum, r) => sum + r.totalDividends, 0);
    return {
      nwAll,
      nw,
      cf,
      totals,
      spend,
      stacked,
      port,
      avg,
      invested,
      market,
      dividends,
      positions: rows.length,
    };
  }, [accounts, transactions, holdings, range]);

  if (!ready) return <PageSkeleton />;

  const nwLast = data.nw[data.nw.length - 1];
  const nwPrev = data.nw[data.nw.length - 2] ?? nwLast;
  const nwDelta =
    nwPrev.net !== 0 ? ((nwLast.net - nwPrev.net) / Math.abs(nwPrev.net)) * 100 : 0;

  const portLast = data.port[data.port.length - 1];
  const portPrev = data.port[data.port.length - 2] ?? portLast;
  const portDelta =
    portPrev.value !== 0
      ? ((portLast.value - portPrev.value) / portPrev.value) * 100
      : 0;
  // Dividends count: they are return the position paid out rather than kept.
  const unrealized = data.market - data.invested + data.dividends;
  const unrealizedPct = data.invested > 0 ? (unrealized / data.invested) * 100 : 0;

  const totalSpend = data.spend.reduce((s, c) => s + c.value, 0);
  const recent = transactions.slice(0, 8);

  return (
    <Shell
      title="Dashboard"
      subtitle="Your complete financial picture at a glance"
      action={
        <div className="flex items-center gap-2">
          <MonthlyChecklistButton onOpen={() => setChecklistOpen(true)} />
          <Button onClick={() => setAddOpen(true)}>
            <ArrowUpRight size={15} /> Add transaction
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* What net worth is made of */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="Net Worth"
            value={fmtCAD(nwLast.net)}
            delta={nwDelta}
            deltaLabel="vs last month"
            icon={<Wallet size={16} />}
            spark={data.nw.map((p) => ({ v: p.net }))}
            sparkKey="v"
            sparkColor="#8b5cf6"
          />
          <StatCard
            label="Investments"
            value={fmtCAD(data.market)}
            delta={portDelta}
            deltaLabel="vs last month"
            icon={<LineChart size={16} />}
            spark={data.port.map((p) => ({ v: p.value }))}
            sparkKey="v"
            sparkColor="#22d3ee"
          />
          <StatCard
            label="Unrealized gain"
            value={fmtSignedCAD(unrealized)}
            delta={unrealizedPct}
            deltaLabel="of what you paid"
            tone={unrealized >= 0 ? "positive" : "negative"}
            icon={<TrendingUp size={16} />}
          />
          <StatCard
            label="Invested"
            value={fmtCAD(data.invested)}
            deltaValue={`${data.positions} positions`}
            deltaLabel="cost basis"
            icon={<Coins size={16} />}
          />
          <StatCard
            label="Cash and accounts"
            value={fmtCAD(nwLast.assets)}
            deltaLabel="everything outside the portfolio"
            tone={nwLast.assets >= 0 ? "neutral" : "negative"}
            icon={<Banknote size={16} />}
            spark={data.nw.map((p) => ({ v: p.assets }))}
            sparkKey="v"
            sparkColor="#f59e0b"
          />
        </div>

        {/* How the months average out */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Average income"
            value={fmtCAD(data.avg.income)}
            deltaValue={`last ${data.avg.months} mo`}
            deltaLabel="per month"
            icon={<ArrowDownRight size={16} className="text-positive" />}
            spark={data.avg.series.map((p) => ({ v: p.income }))}
            sparkKey="v"
            sparkColor="#34d399"
          />
          <StatCard
            label="Average expenses"
            value={fmtCAD(data.avg.expenses)}
            deltaValue={`last ${data.avg.months} mo`}
            deltaLabel="per month"
            icon={<ArrowUpRight size={16} className="text-negative" />}
            spark={data.avg.series.map((p) => ({ v: p.expenses }))}
            sparkKey="v"
            sparkColor="#fb7185"
          />
          <StatCard
            label="Average uncommitted"
            value={fmtCAD(data.avg.uncommitted)}
            deltaValue={`last ${data.avg.months} mo`}
            deltaLabel="after committed costs"
            tone={data.avg.uncommitted >= 0 ? "positive" : "negative"}
            icon={<PiggyBank size={16} />}
            spark={data.avg.series.map((p) => ({ v: p.uncommitted }))}
            sparkKey="v"
            sparkColor="#22d3ee"
          />
          <StatCard
            label="Average passive income"
            value={fmtCAD(data.avg.passive)}
            deltaValue={`last ${data.avg.months} mo`}
            deltaLabel="dividends and interest"
            icon={<Coins size={16} />}
            spark={data.avg.series.map((p) => ({ v: p.passive }))}
            sparkKey="v"
            sparkColor="#a78bfa"
          />
        </div>

        {/* Net worth + expense donut */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Net worth over time"
              subtitle={`Assets + portfolio − liabilities · ${fmtCAD(nwLast.assets)} + ${fmtCAD(nwLast.portfolio)} − ${fmtCAD(nwLast.liabilities)}`}
              action={
                <Segmented<Range>
                  options={[
                    { value: "6", label: "6M" },
                    { value: "12", label: "12M" },
                    { value: "18", label: "18M" },
                  ]}
                  value={range}
                  onChange={setRange}
                />
              }
            />
            <div className="px-3 pb-4">
              <SeriesChart
                data={data.nw as unknown as Record<string, unknown>[]}
                xKey="label"
                series={[{ key: "net", name: "Net worth", color: "#8b5cf6" }]}
                height={300}
                yFmt={fmtCompact}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Where money went"
              subtitle="Expense breakdown · this month"
            />
            <div className="px-5 pb-5">
              {totalSpend > 0 ? (
                <DonutChart
                  data={data.spend}
                  centerLabel="Spent"
                  centerValue={fmtCAD(totalSpend)}
                  fmt={(n) => fmtCAD(n)}
                  height={210}
                />
              ) : (
                <p className="py-20 text-center text-xs text-ink-faint">
                  No expenses recorded this month yet.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Cash flow + portfolio */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Income vs expenses"
              subtitle="Monthly cash flow · last 12 months"
            />
            <div className="px-3 pb-4">
              <GroupedBars
                data={data.cf as unknown as Record<string, unknown>[]}
                xKey="label"
                bars={[
                  { key: "income", name: "Income", color: "#34d399" },
                  { key: "expenses", name: "Expenses", color: "#fb7185" },
                ]}
                height={280}
                yFmt={fmtCompact}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Investment portfolio"
              subtitle={
                holdings.length === 0
                  ? "Add holdings to see growth"
                  : `Market value vs cost basis · ${fmtCAD(data.port[data.port.length - 1].value)} invested`
              }
              action={
                <Link href="/investments">
                  <Button variant="ghost" size="sm">
                    Details <ArrowRight size={13} />
                  </Button>
                </Link>
              }
            />
            <div className="px-3 pb-4">
              <SeriesChart
                data={data.port as unknown as Record<string, unknown>[]}
                xKey="label"
                series={[
                  { key: "value", name: "Market value", color: "#22d3ee" },
                  {
                    key: "cost",
                    name: "Cost basis",
                    color: "#6e6e79",
                    kind: "line",
                    dashed: true,
                  },
                ]}
                height={280}
                yFmt={fmtCompact}
              />
            </div>
          </Card>
        </div>

        {/* Category trend + accounts */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Spending by category"
              subtitle="Top five categories · last 12 months (stacked)"
            />
            <div className="px-3 pb-4">
              <SeriesChart
                data={data.stacked}
                xKey="label"
                stacked
                series={["Housing", "Groceries", "Dining", "Transport", "Shopping"].map(
                  (cat, i) => ({
                    key: cat,
                    name: cat,
                    color: PALETTE[i % PALETTE.length],
                  }),
                )}
                height={280}
                yFmt={fmtCompact}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Accounts"
              subtitle={`${accounts.length} connected`}
              action={
                <Link href="/accounts">
                  <Button variant="ghost" size="sm">
                    All <ArrowRight size={13} />
                  </Button>
                </Link>
              }
            />
            <ul className="space-y-1 px-3 pb-4">
              {accounts.slice(0, 6).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-elevated"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="text-[11px] text-ink-faint">
                      {ACCOUNT_KIND_LABELS[a.kind]} · {a.institution}
                    </p>
                  </div>
                  <span className="ml-3 shrink-0 text-sm font-semibold tabular-nums">
                    {fmtCAD(a.balance)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* Recent transactions */}
        <Card>
          <CardHeader
            title="Recent transactions"
            subtitle="Latest activity across all accounts"
            action={
              <Link href="/transactions">
                <Button variant="ghost" size="sm">
                  View all <ArrowRight size={13} />
                </Button>
              </Link>
            }
          />
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full text-sm">
              <tbody>
                {recent.map((t) => {
                  const acc = accounts.find((a) => a.id === primaryAccountId(t));
                  return (
                    <tr key={t.id} className="border-t border-line/60">
                      <td className="px-3 py-2.5 text-ink-dim tabular-nums">
                        {labelDate(t.date)}
                      </td>
                      <td className="px-3 py-2.5 font-medium">{t.payee}</td>
                      <td className="hidden px-3 py-2.5 sm:table-cell">
                        <Badge>{t.category}</Badge>
                      </td>
                      <td className="hidden px-3 py-2.5 text-ink-faint md:table-cell">
                        {acc?.name ?? "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-semibold tabular-nums",
                          t.type === "income" ? "text-positive" : "text-ink",
                        )}
                      >
                        {t.type === "income" ? "+" : "−"}
                        {fmtCAD(t.amount, 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <p className="text-center text-[11px] text-ink-faint">
          Net worth changed {fmtSignedCAD(nwLast.net - nwPrev.net)} ({fmtPct(nwDelta)})
          over the last month · portfolio is{" "}
          {fmtSignedCAD(data.port[data.port.length - 1].value - data.port[0].value)}{" "}
          over 18 months
        </p>
      </div>

      <TransactionForm open={addOpen} onClose={() => setAddOpen(false)} />
      <MonthlyChecklistModal open={checklistOpen} onClose={() => setChecklistOpen(false)} />
    </Shell>
  );
}
