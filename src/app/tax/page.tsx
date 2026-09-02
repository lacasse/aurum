"use client";

import { useMemo, useState } from "react";
import { Badge, Card, CardHeader, EmptyState, Segmented, cn } from "@/components/ui";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import { taxYears } from "@/lib/tax";
import { fmtCAD, fmtSignedCAD, labelDate } from "@/lib/format";
import { Coins, Landmark, Receipt, ShieldCheck } from "lucide-react";

/**
 * What a year owes tax on.
 *
 * Everything here was already recorded — the cost base behind each sale, the
 * date on each dividend, the registration on each account. What was missing
 * was anywhere that put them together, and the registration is the part that
 * decides whether a number belongs on a return at all.
 */
export default function TaxPage() {
  const ready = useReady();
  const holdings = useFinance((s) => s.holdings);
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const [year, setYear] = useState<string | null>(null);

  const years = useMemo(
    () => taxYears(holdings, accounts, transactions),
    [holdings, accounts, transactions],
  );

  if (!ready) return <PageSkeleton />;

  if (years.length === 0) {
    return (
      <Shell title="Tax" subtitle="Realized gains, dividends and interest by year">
        <EmptyState
          title="Nothing to report yet"
          subtitle="A year appears here once something has been sold, or a dividend or interest recorded."
        />
      </Shell>
    );
  }

  const selected = years.find((y) => y.year === year) ?? years[0];
  const income = selected.dividends + selected.interest;
  const unpricedLoss = selected.unpriced.reduce((sum, d) => sum + d.gain, 0);

  return (
    <Shell
      title="Tax"
      subtitle="Realized gains, dividends and interest, by year"
      action={
        <Segmented<string>
          options={years.slice(0, 5).map((y) => ({ value: y.year, label: y.year }))}
          value={selected.year}
          onChange={setYear}
        />
      }
    >
      <div className="space-y-4">
        {selected.unpriced.length > 0 && (
          <Card className="border-amber-500/40 bg-amber-500/5 p-4">
            <p className="text-sm font-medium text-amber-400">
              {selected.unpriced.length} disposal
              {selected.unpriced.length === 1 ? "" : "s"} in {selected.year} with
              no proceeds recorded
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-dim">
              A sale for nothing reads as a loss of the whole cost base — these
              come to {fmtSignedCAD(unpricedLoss)}, which is most of the figure
              above. Almost always it means the proceeds were never entered
              rather than that the position was given away. Correct them on the
              Investments page before this year is used for anything.
            </p>
            <ul className="mt-3 space-y-1 text-xs text-ink-dim">
              {selected.unpriced.map((d, i) => (
                <li key={`${d.date}-${d.ticker}-${i}`} className="tabular-nums">
                  {labelDate(d.date)} · <span className="font-medium">{d.ticker}</span>{" "}
                  · cost base {fmtCAD(d.acb, 2)} · proceeds $0
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={`Realized gain · ${selected.year}`}
            value={fmtSignedCAD(selected.gain)}
            deltaLabel="in accounts with no shelter"
            tone={selected.gain >= 0 ? "positive" : "negative"}
            icon={<Receipt size={16} />}
          />
          <StatCard
            label="Proceeds"
            value={fmtCAD(selected.proceeds)}
            deltaValue={`${selected.taxable.length} disposal${selected.taxable.length === 1 ? "" : "s"}`}
            deltaLabel={`against ${fmtCAD(selected.acb)} of cost`}
            icon={<Landmark size={16} />}
          />
          <StatCard
            label="Dividends and interest"
            value={fmtCAD(income)}
            deltaLabel={`${fmtCAD(selected.dividends)} dividends · ${fmtCAD(selected.interest)} interest`}
            icon={<Coins size={16} />}
          />
          <StatCard
            label="Sheltered gain"
            value={fmtSignedCAD(selected.shelteredGain)}
            deltaValue={`${selected.shelteredCount} disposal${selected.shelteredCount === 1 ? "" : "s"}`}
            deltaLabel="inside registered accounts — not reportable"
            icon={<ShieldCheck size={16} />}
          />
        </div>

        <Card>
          <CardHeader
            title={`Disposals · ${selected.year}`}
            subtitle="Every sale in an account with no shelter, and the cost base that went with it"
          />
          {selected.taxable.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-ink-faint">
              Nothing was sold outside a registered account in {selected.year}.
              {selected.shelteredCount > 0
                ? ` The ${selected.shelteredCount} disposal${selected.shelteredCount === 1 ? "" : "s"} that year happened inside one, where a gain is not a taxable event.`
                : ""}
            </p>
          ) : (
            <div className="overflow-x-auto px-2 pb-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Security</th>
                    <th className="px-3 py-2 text-right font-medium">Units</th>
                    <th className="px-3 py-2 text-right font-medium">Proceeds</th>
                    <th className="px-3 py-2 text-right font-medium">Cost base</th>
                    <th className="px-3 py-2 text-right font-medium">Gain</th>
                    <th className="hidden px-3 py-2 text-left font-medium md:table-cell">
                      Account
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selected.taxable.map((d, i) => (
                    <tr key={`${d.date}-${d.ticker}-${i}`} className="border-t border-line/60">
                      <td className="px-3 py-2.5 tabular-nums text-ink-dim">
                        {labelDate(d.date)}
                      </td>
                      <td className="px-3 py-2.5 font-medium">{d.ticker}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-dim">
                        {d.units}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {fmtCAD(d.proceeds, 2)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-dim">
                        {fmtCAD(d.acb, 2)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-semibold tabular-nums",
                          d.gain >= 0 ? "text-positive" : "text-negative",
                        )}
                      >
                        {fmtSignedCAD(d.gain)}
                      </td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        <Badge>{d.accountName}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Every year on record" subtitle="Taxable gain, income, and what was sheltered" />
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                  <th className="px-3 py-2 text-left font-medium">Year</th>
                  <th className="px-3 py-2 text-right font-medium">Proceeds</th>
                  <th className="px-3 py-2 text-right font-medium">Cost base</th>
                  <th className="px-3 py-2 text-right font-medium">Gain</th>
                  <th className="px-3 py-2 text-right font-medium">Dividends</th>
                  <th className="px-3 py-2 text-right font-medium">Interest</th>
                  <th className="px-3 py-2 text-right font-medium">Sheltered</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr
                    key={y.year}
                    className={cn(
                      "cursor-pointer border-t border-line/60 hover:bg-elevated",
                      y.year === selected.year && "bg-elevated",
                    )}
                    onClick={() => setYear(y.year)}
                  >
                    <td className="px-3 py-2.5 font-medium tabular-nums">{y.year}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-dim">
                      {fmtCAD(y.proceeds)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-dim">
                      {fmtCAD(y.acb)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right font-semibold tabular-nums",
                        y.gain >= 0 ? "text-positive" : "text-negative",
                      )}
                    >
                      {fmtSignedCAD(y.gain)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-dim">
                      {fmtCAD(y.dividends)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-dim">
                      {fmtCAD(y.interest)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-faint">
                      {fmtSignedCAD(y.shelteredGain)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-medium">What this is, and what it is not</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-dim">
            A summary of what the app has recorded, on the average-cost method,
            with registered accounts kept out of every taxable figure. It is not
            a return and not advice: the inclusion rate, the superficial loss
            rule, foreign property reporting and anything owed on income that
            never passed through here all belong to whoever files. Interest is
            recorded together with cashback, which is not income — that line
            needs splitting before it is used.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
