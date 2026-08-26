"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  PiggyBank,
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
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import {
  cashflowSeries,
  monthTotals,
  netWorthSeries,
  portfolioSeries,
  spendByCategory,
  stackedSpend,
} from "@/lib/analytics";
import {
  fmtCompact,
  fmtPct,
  fmtSignedUSD,
  fmtUSD,
  labelDate,
} from "@/lib/format";
import { ACCOUNT_KIND_LABELS } from "@/lib/types";

type Range = "6" | "12" | "18";

export default function DashboardPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const holdings = useFinance((s) => s.holdings);
  const [range, setRange] = useState<Range>("12");
  const [addOpen, setAddOpen] = useState(false);

  const data = useMemo(() => {
    const nwAll = netWorthSeries(accounts, holdings, 18);
    const nw = nwAll.slice(-Number(range));
    const cf = cashflowSeries(transactions, 12);
    const totals = monthTotals(transactions);
    const prevTotals = (() => {
      const prevKey = cf.length >= 2 ? cf[cf.length - 2].key : undefined;
      return prevKey ? monthTotals(transactions, prevKey) : totals;
    })();
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
    return { nwAll, nw, cf, totals, prevTotals, spend, stacked, port };
  }, [accounts, transactions, holdings, range]);

  if (!ready) return <PageSkeleton />;

  const nwLast = data.nw[data.nw.length - 1];
  const nwPrev = data.nw[data.nw.length - 2] ?? nwLast;
  const nwDelta =
    nwPrev.net !== 0 ? ((nwLast.net - nwPrev.net) / Math.abs(nwPrev.net)) * 100 : 0;

  const incDelta =
    data.prevTotals.income !== 0
      ? ((data.totals.income - data.prevTotals.income) / data.prevTotals.income) * 100
      : 0;
  const expDelta =
    data.prevTotals.expenses !== 0
      ? ((data.totals.expenses - data.prevTotals.expenses) / data.prevTotals.expenses) * 100
      : 0;

  const totalSpend = data.spend.reduce((s, c) => s + c.value, 0);
  const recent = transactions.slice(0, 8);

  return (
    <Shell
      title="Dashboard"
      subtitle="Your complete financial picture at a glance"
      action={
        <Button onClick={() => setAddOpen(true)}>
          <ArrowUpRight size={15} /> Add transaction
        </Button>
      }
    >
      <div className="space-y-4">
        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Net Worth"
            value={fmtUSD(nwLast.net)}
            delta={nwDelta}
            deltaLabel="vs last month"
            icon={<Wallet size={16} />}
            spark={data.nw.map((p) => ({ v: p.net }))}
            sparkKey="v"
            sparkColor="#8b5cf6"
          />
          <StatCard
            label="Income · this month"
            value={fmtUSD(data.totals.income)}
            delta={incDelta}
            deltaLabel="vs last month"
            icon={<ArrowDownRight size={16} className="text-positive" />}
            spark={data.cf.map((p) => ({ v: p.income }))}
            sparkKey="v"
            sparkColor="#34d399"
          />
          <StatCard
            label="Expenses · this month"
            value={fmtUSD(data.totals.expenses)}
            delta={expDelta}
            deltaLabel="vs last month"
            tone={expDelta > 0 ? "negative" : "positive"}
            icon={<ArrowUpRight size={16} className="text-negative" />}
            spark={data.cf.map((p) => ({ v: p.expenses }))}
            sparkKey="v"
            sparkColor="#fb7185"
          />
          <StatCard
            label="Savings rate"
            value={`${data.totals.savingsRate.toFixed(1)}%`}
            deltaLabel={`kept ${fmtUSD(data.totals.net)} of income`}
            icon={<PiggyBank size={16} />}
            spark={data.cf.map((p) => ({
              v: p.income > 0 ? ((p.income - p.expenses) / p.income) * 100 : 0,
            }))}
            sparkKey="v"
            sparkColor="#22d3ee"
          />
        </div>

        {/* Net worth + expense donut */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Net worth over time"
              subtitle={`Assets + portfolio − liabilities · ${fmtUSD(nwLast.assets)} + ${fmtUSD(nwLast.portfolio)} − ${fmtUSD(nwLast.liabilities)}`}
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
                  centerValue={fmtUSD(totalSpend)}
                  fmt={(n) => fmtUSD(n)}
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
                  : `Market value vs cost basis · ${fmtUSD(data.port[data.port.length - 1].value)} invested`
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
                    {fmtUSD(a.balance)}
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
                  const acc = accounts.find((a) => a.id === t.accountId);
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
                        {fmtUSD(t.amount, 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <p className="text-center text-[11px] text-ink-faint">
          Net worth changed {fmtSignedUSD(nwLast.net - nwPrev.net)} ({fmtPct(nwDelta)})
          over the last month · portfolio is{" "}
          {fmtSignedUSD(data.port[data.port.length - 1].value - data.port[0].value)}{" "}
          over 18 months
        </p>
      </div>

      <TransactionForm open={addOpen} onClose={() => setAddOpen(false)} />
    </Shell>
  );
}
