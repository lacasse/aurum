"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  Bitcoin,
  CreditCard,
  HandCoins,
  Home,
  Landmark,
  Pencil,
  PiggyBank,
  ShieldCheck,
  Plus,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Badge, Button, Card, CardHeader, Segmented } from "@/components/ui";
import { SeriesChart, Sparkline } from "@/components/charts";
import { AccountForm, ConfirmDelete } from "@/components/forms";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import {
  accountCadBalance,
  accountValueAt,
  allTimeSeries,
  firstAccountMonth,
  firstFlowMonth,
  monthsSince,
  netWorthOver,
  portfolioSeries,
} from "@/lib/analytics";
import { summarize as summarizePension } from "@/lib/pension";
import { fmtCompact, fmtSignedCAD, fmtCAD, labelMonth, lastMonthKeys } from "@/lib/format";
import {
  ACCOUNT_KIND_LABELS,
  Account,
  AccountKind,
  isLiability,
  isPension,
} from "@/lib/types";

/** How much of the record to draw: months, or all of it. */
type Range = "12" | "60" | "all";

const KIND_ICON: Record<AccountKind, typeof Wallet> = {
  checking: Wallet,
  savings: PiggyBank,
  cash: Banknote,
  investment: TrendingUp,
  crypto: Bitcoin,
  // A promise rather than a pot of money: the icon says "guaranteed", not
  // "invested".
  pension: ShieldCheck,
  property: Home,
  credit: CreditCard,
  // Not a car: the loans here are student and personal debt, and an icon that
  // names a kind of purchase says the wrong thing about all of them.
  loan: HandCoins,
};

export default function AccountsPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const holdings = useFinance((s) => s.holdings);
  const transactions = useFinance((s) => s.transactions);
  const deleteAccount = useFinance((s) => s.deleteAccount);
  const usdCadRate = useFinance((s) => s.usdCadRate);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [range, setRange] = useState<Range>("all");

  /*
   * Recorded month-end portfolio values, from the store: four pages draw a
   * chart from this history and it is fetched once for all of them.
   */
  const snapshots = useFinance((s) => s.snapshotHistory);
  const loadSnapshotHistory = useFinance((s) => s.loadSnapshotHistory);
  useEffect(() => {
    loadSnapshotHistory();
  }, [loadSnapshotHistory]);

  const data = useMemo(() => {
    const starts = [
      firstAccountMonth(accounts),
      Object.keys(snapshots).sort()[0] ?? null,
      firstFlowMonth(holdings),
    ].filter((m): m is string => m !== null);
    const historyStart = starts.length > 0 ? starts.sort()[0] : null;
    const portAll =
      historyStart && Object.keys(snapshots).length > 0
        ? allTimeSeries(holdings, {}, monthsSince(historyStart), snapshots).points
        : portfolioSeries(holdings, 18);
    const series = netWorthOver(accounts, portAll, usdCadRate);
    let assets = 0;
    let liabilities = 0;
    let pension = 0;
    for (const a of accounts) {
      const value = accountCadBalance(a, usdCadRate);
      if (isLiability(a.kind)) liabilities += value;
      else if (isPension(a.kind)) pension += value;
      else assets += value;
    }
    /*
     * The pension is two numbers, not one: what the plan says it is worth,
     * and what was paid in to earn it. The gap between them is the employer's
     * side and the growth, which is the part of it that never appears on a
     * pay stub.
     */
    const pensions = accounts
      .filter((a) => isPension(a.kind))
      .map((a) => ({ account: a, summary: summarizePension(a, transactions) }));
    /*
     * Net worth is only net worth once the portfolio is in it. Before the
     * first recorded portfolio value the series carries cash and debt alone,
     * which on this record reads as months of being tens of thousands in the
     * red — so the sparkline starts where the portfolio does.
     */
    const portfolioFrom =
      [Object.keys(snapshots).sort()[0] ?? null, firstFlowMonth(holdings)]
        .filter((m): m is string => m !== null)
        .sort()[0] ?? null;
    const netSpark = portfolioFrom
      ? series.filter((p) => p.key >= portfolioFrom)
      : series;
    return { series, netSpark, assets, liabilities, pension, pensions };
  }, [accounts, holdings, transactions, snapshots, usdCadRate]);

  if (!ready) return <PageSkeleton />;

  const portfolio = data.series[data.series.length - 1]?.portfolio ?? 0;
  const netWorth = data.assets + data.pension + portfolio - data.liabilities;
  // Everything you could actually reach. The pension is yours and counts in
  // net worth, but it cannot pay a bill until you leave the plan.
  const liquid = netWorth - data.pension;
  const ratio = netWorth > 0 ? (data.liabilities / netWorth) * 100 : 0;

  const series =
    range === "all" ? data.series : data.series.slice(-Number(range));
  const hasPension = data.pensions.length > 0;

  /**
   * How much the account moved over the last month, or nothing when that
   * cannot be said.
   *
   * The version this replaced fell back to the *oldest* recorded value
   * whenever a month was missing — and the current month is missing until
   * something writes it. So the chequing account compared today's $3,628.38
   * against its balance in February 2020 and reported the difference as one
   * month's movement: −$688 a month, every month, for six years.
   */
  const accountDelta1m = (acc: Account): number | undefined => {
    const [prevKey, curKey] = lastMonthKeys(2);
    const opened = acc.history[0]?.month;
    // An account younger than the comparison has no month to compare with.
    if (!opened || opened > prevKey) return undefined;
    return accountValueAt(acc, curKey) - accountValueAt(acc, prevKey);
  };

  return (
    <Shell
      title="Accounts"
      subtitle="Bank accounts, property and debts feed your net worth"
      action={
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus size={15} /> Add account
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Cash"
            value={fmtCAD(data.assets)}
            deltaLabel="across your accounts, ready to spend"
            icon={<Banknote size={16} />}
          />
          <StatCard
            label="Debt"
            value={fmtCAD(data.liabilities)}
            /*
             * Against net worth, not against cash. Measured against cash it
             * read 121.6% — a true ratio of two small numbers that sounded
             * like an alarm, when the debt is under one percent of what you
             * own.
             */
            deltaLabel={`${ratio.toFixed(1)}% of net worth`}
            tone="negative"
            icon={<CreditCard size={16} />}
          />
          <StatCard
            label="Net worth"
            value={fmtCAD(netWorth)}
            deltaLabel={
              hasPension
                ? `${fmtCAD(liquid)} of it reachable today`
                : `incl. ${fmtCAD(portfolio)} portfolio`
            }
            icon={<PiggyBank size={16} />}
            spark={data.netSpark.map((p) => ({ v: p.net }))}
            sparkKey="v"
            sparkColor="#34d399"
          />
          <StatCard
            label="Portfolio"
            value={fmtCAD(portfolio)}
            deltaLabel="tracked separately on Investments"
            icon={<Landmark size={16} />}
          />
        </div>

        <Card>
          <CardHeader
            title="Cash vs debt"
            subtitle={`${fmtCAD(data.assets)} to hand against ${fmtCAD(data.liabilities)} owed`}
            action={
              <Segmented<Range>
                options={[
                  { value: "12", label: "1Y" },
                  { value: "60", label: "5Y" },
                  { value: "all", label: "All" },
                ]}
                value={range}
                onChange={setRange}
              />
            }
          />
          <div className="px-3 pb-4">
            {/*
              * The two things this page is actually about.
              *
              * A whole balance sheet belongs on the dashboard, and it was
              * drawn there: net worth over time, and the portfolio under it.
              * Repeating it here buried the answer, because next to half a
              * million dollars of portfolio a few thousand of cash and debt
              * is a flat line on the floor — the student loan reaching
              * $77,264 and being paid down to $4,413 was invisible.
              *
              * At their own scale they are legible, and they are the pair
              * that decides whether a month is comfortable.
              */}
            <SeriesChart
              data={series as unknown as Record<string, unknown>[]}
              xKey="label"
              series={[
                { key: "assets", name: "Cash", color: "#8b5cf6" },
                { key: "liabilities", name: "Debt", color: "#fb7185" },
              ]}
              height={280}
              yFmt={fmtCompact}
            />
          </div>
        </Card>

        {data.pensions.map(({ account, summary }) => (
          <Card key={account.id}>
            <CardHeader
              title={account.name}
              subtitle={
                summary.asOf
                  ? `Transfer value from your plan · last entered ${labelMonth(summary.asOf)}`
                  : "Transfer value · nothing entered yet"
              }
              action={
                <Link href="/guide#pension">
                  <Button variant="ghost" size="sm">
                    Guide <ArrowRight size={13} />
                  </Button>
                </Link>
              }
            />
            <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-[0.6875rem] text-ink-faint">Transfer value</p>
                <p className="text-lg font-semibold tabular-nums">
                  {fmtCAD(summary.value)}
                </p>
                {summary.estimated ? (
                  <Badge className="mt-1">Estimated</Badge>
                ) : null}
              </div>
              <div>
                <p className="text-[0.6875rem] text-ink-faint">You have contributed</p>
                <p className="text-lg font-semibold tabular-nums">
                  {fmtCAD(summary.contributed)}
                </p>
                <p className="mt-1 text-[0.6875rem] text-ink-faint">
                  {fmtCAD(summary.monthly)} a month lately
                </p>
              </div>
              <div>
                <p className="text-[0.6875rem] text-ink-faint">Beyond contributions</p>
                <p
                  className={
                    "text-lg font-semibold tabular-nums " +
                    (summary.beyondContributions >= 0 ? "text-positive" : "text-negative")
                  }
                >
                  {fmtSignedCAD(summary.beyondContributions)}
                </p>
                <p className="mt-1 text-[0.6875rem] text-ink-faint">
                  employer’s side and growth
                </p>
              </div>
              <div>
                <p className="text-[0.6875rem] text-ink-faint">If you stay</p>
                <p className="text-lg font-semibold tabular-nums">
                  {account.pensionAnnual
                    ? `${fmtCAD(account.pensionAnnual)}/yr`
                    : "—"}
                </p>
                <p className="mt-1 text-[0.6875rem] text-ink-faint">
                  {account.pensionService
                    ? `${account.pensionService} years of service`
                    : "Add it from your statement"}
                </p>
              </div>
            </div>
            {summary.series.length > 1 ? (
              <div className="px-3 pb-4">
                <SeriesChart
                  data={
                    summary.series.map((p) => ({
                      label: labelMonth(p.month),
                      value: p.value,
                      contributed: p.contributed,
                    })) as unknown as Record<string, unknown>[]
                  }
                  xKey="label"
                  series={[
                    { key: "value", name: "Transfer value", color: "#f59e0b" },
                    {
                      key: "contributed",
                      name: "Contributed",
                      color: "#6e6e79",
                      kind: "line",
                      dashed: true,
                    },
                  ]}
                  height={200}
                  yFmt={fmtCompact}
                />
              </div>
            ) : null}
          </Card>
        ))}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((acc) => {
            const Icon = KIND_ICON[acc.kind];
            const liability = isLiability(acc.kind);
            const delta = accountDelta1m(acc);
            const hist =
              acc.history.length > 1
                ? acc.history.map((p) => ({ v: p.value }))
                : [];
            return (
              <Card key={acc.id} className="p-5">
                <div className="flex items-start justify-between">
                  <span className="flex items-center gap-2.5">
                    <span
                      className={
                        "flex h-9 w-9 items-center justify-center rounded-xl " +
                        (liability
                          ? "bg-negative/10 text-negative"
                          : "bg-brand/10 text-brand")
                      }
                    >
                      <Icon size={17} />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{acc.name}</span>
                      <span className="block text-[0.6875rem] text-ink-faint">
                        {acc.institution}
                        {acc.registration && acc.registration !== "non-registered"
                          ? ` · ${acc.registration}`
                          : ""}
                      </span>
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${acc.name}`}
                      onClick={() => {
                        setEditing(acc);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${acc.name}`}
                      onClick={() => setDeleting(acc)}
                      className="hover:text-negative"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </span>
                </div>

                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                      {liability ? "Owed" : "Balance"}
                    </p>
                    <p className="text-xl font-semibold tabular-nums">
                      {fmtCAD(accountCadBalance(acc, usdCadRate))}
                    </p>
                    {/* Both sides shown when there is a US balance: the total
                        above is converted at today's rate, which is not the
                        rate it will settle at. */}
                    {acc.balanceUSD ? (
                      <p className="mt-0.5 text-[0.6875rem] tabular-nums text-ink-faint">
                        {fmtCAD(acc.balance)} CAD · $
                        {acc.balanceUSD.toLocaleString("en-CA", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        USD
                      </p>
                    ) : null}
                    {/*
                      An asset account cannot hold less than no cash. When one
                      does, the balance has been moved by something already
                      counted in it — the case that made this worth saying out
                      loud: two accounts drifted tens of thousands negative and
                      nothing on the page mentioned it.
                    */}
                    {!liability && acc.balance < 0 ? (
                      <p className="mt-1 text-[0.6875rem] font-medium text-negative">
                        Negative cash — restate the balance to correct it
                      </p>
                    ) : null}
                  </div>
                  {delta !== undefined && delta !== 0 ? (
                    <Badge tone={(delta >= 0) !== liability ? "positive" : "negative"}>
                      {fmtSignedCAD(liability ? -delta : delta)} / mo
                    </Badge>
                  ) : (
                    <Badge>{ACCOUNT_KIND_LABELS[acc.kind]}</Badge>
                  )}
                </div>

                {hist.length > 1 ? (
                  <div className="-mx-1 mt-3 opacity-90">
                    <Sparkline
                      data={hist}
                      dataKey="v"
                      color={liability ? "#fb7185" : "#8b5cf6"}
                      height={72}
                    />
                    <div className="mt-1 flex justify-between text-[0.625rem] text-ink-faint">
                      <span>{labelMonth(acc.history[0].month)}</span>
                      <span>{labelMonth(acc.history[acc.history.length - 1].month)}</span>
                    </div>
                  </div>
                ) : null}
              </Card>
            );
          })}

          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-ink-faint transition-colors hover:border-brand/60 hover:text-brand"
          >
            <Plus size={20} />
            <span className="text-sm font-medium">Add an account</span>
            <span className="max-w-[220px] text-center text-[0.6875rem]">
              Checking, savings, property, credit cards and loans all count toward net worth
            </span>
          </button>
        </div>
      </div>

      <AccountForm
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
        onConfirm={() => deleting && deleteAccount(deleting.id)}
        title="Delete account"
        message={`Remove “${deleting?.name ?? ""}" from your accounts? Existing transactions will remain but lose their link.`}
      />
    </Shell>
  );
}
