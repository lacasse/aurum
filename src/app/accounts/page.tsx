"use client";

import { useMemo, useState } from "react";
import {
  Banknote,
  Bitcoin,
  Car,
  CreditCard,
  Home,
  Landmark,
  Pencil,
  PiggyBank,
  Plus,
  Trash2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { SeriesChart, Sparkline } from "@/components/charts";
import { AccountForm, ConfirmDelete } from "@/components/forms";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import { accountCadBalance, netWorthSeries } from "@/lib/analytics";
import { fmtCompact, fmtSignedCAD, fmtCAD, labelMonth, lastMonthKeys } from "@/lib/format";
import {
  ACCOUNT_KIND_LABELS,
  Account,
  AccountKind,
  isLiability,
} from "@/lib/types";

const KIND_ICON: Record<AccountKind, typeof Wallet> = {
  checking: Wallet,
  savings: PiggyBank,
  cash: Banknote,
  investment: TrendingUp,
  crypto: Bitcoin,
  property: Home,
  credit: CreditCard,
  loan: Car,
};

export default function AccountsPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const holdings = useFinance((s) => s.holdings);
  const deleteAccount = useFinance((s) => s.deleteAccount);
  const usdCadRate = useFinance((s) => s.usdCadRate);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  const data = useMemo(() => {
    const series = netWorthSeries(accounts, holdings, 18, usdCadRate);
    let assets = 0;
    let liabilities = 0;
    for (const a of accounts) {
      const value = accountCadBalance(a, usdCadRate);
      if (isLiability(a.kind)) liabilities += value;
      else assets += value;
    }
    return { series, assets, liabilities };
  }, [accounts, holdings, usdCadRate]);

  if (!ready) return <PageSkeleton />;

  const netWorth = data.assets + (data.series[data.series.length - 1]?.portfolio ?? 0) - data.liabilities;
  const ratio = data.assets > 0 ? (data.liabilities / data.assets) * 100 : 0;

  const accountDelta1m = (acc: Account): number | undefined => {
    const keys = lastMonthKeys(2);
    const at = (k: string) =>
      acc.history.find((p) => p.month === k)?.value ??
      acc.history[0]?.value ??
      acc.balance;
    const prev = at(keys[0]);
    const cur = at(keys[1]);
    return cur - prev;
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
          <StatCard label="Total assets" value={fmtCAD(data.assets)} icon={<Landmark size={16} />} />
          <StatCard
            label="Total liabilities"
            value={fmtCAD(data.liabilities)}
            deltaLabel={`${ratio.toFixed(1)}% of assets`}
            tone="negative"
            icon={<CreditCard size={16} />}
          />
          <StatCard
            label="Net worth"
            value={fmtCAD(netWorth)}
            deltaLabel={`incl. ${fmtCAD(data.series[data.series.length - 1]?.portfolio ?? 0)} portfolio`}
            icon={<PiggyBank size={16} />}
            spark={data.series.map((p) => ({ v: p.net }))}
            sparkKey="v"
            sparkColor="#34d399"
          />
          <StatCard
            label="Portfolio"
            value={fmtCAD(data.series[data.series.length - 1]?.portfolio ?? 0)}
            deltaLabel="tracked separately on Investments"
            icon={<Landmark size={16} />}
          />
        </div>

        <Card>
          <CardHeader
            title="Assets vs liabilities"
            subtitle="How the balance sheet has evolved · 18 months"
          />
          <div className="px-3 pb-4">
            <SeriesChart
              data={data.series as unknown as Record<string, unknown>[]}
              xKey="label"
              stacked
              series={[
                { key: "assets", name: "Assets", color: "#8b5cf6" },
                { key: "liabilities", name: "Liabilities", color: "#fb7185" },
              ]}
              height={280}
              yFmt={fmtCompact}
            />
          </div>
        </Card>

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
                      <span className="block text-[11px] text-ink-faint">
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
                    <p className="text-[11px] uppercase tracking-wider text-ink-faint">
                      {liability ? "Owed" : "Balance"}
                    </p>
                    <p className="text-xl font-semibold tabular-nums">
                      {fmtCAD(accountCadBalance(acc, usdCadRate))}
                    </p>
                    {/* Both sides shown when there is a US balance: the total
                        above is converted at today's rate, which is not the
                        rate it will settle at. */}
                    {acc.balanceUSD ? (
                      <p className="mt-0.5 text-[11px] tabular-nums text-ink-faint">
                        {fmtCAD(acc.balance)} CAD · $
                        {acc.balanceUSD.toLocaleString("en-CA", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        USD
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
                      height={44}
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
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
            <span className="max-w-[220px] text-center text-[11px]">
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
