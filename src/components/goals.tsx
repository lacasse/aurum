"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { PartyPopper, Plus, Target, Trash2 } from "lucide-react";
import { Badge, Button, Field, Input, Modal, Progress, Select, cn } from "./ui";
import { useFinance } from "@/lib/store";
import { getSettings, saveSettings } from "@/lib/api";
import { useIncomeTransactions, useSpendGroups } from "@/lib/hooks";
import { netExternalFlows, netWorthOver, portfolioHistory, portfolioSeries } from "@/lib/analytics";
import { DONATIONS_CATEGORY, groupOf } from "@/lib/expenses";
import {
  REGISTERED_PLANS,
  type ContributionLimits,
  type RegisteredPlan,
} from "@/lib/contributions";
import { fmtCAD, todayISO } from "@/lib/format";
import { uid } from "@/lib/ids";
import { SHOW_UNRELEASED } from "@/lib/unreleased";
import {
  METRICS,
  describe,
  measure,
  monthName,
  newlyMet,
  specOf,
  type Goal,
  type GoalBasis,
  type GoalInputs,
  type GoalMetric,
  type GoalProgress,
  type GoalStatus,
} from "@/lib/goals";

/* ── The goals, shared by every page that shows or watches them ── */

interface GoalStore {
  goals: Goal[];
  /** "loading" until the first read lands; "failed" says so on screen. */
  state: "idle" | "loading" | "ready" | "failed";
  load: () => Promise<void>;
  /** Replaces the list, on screen at once and in storage behind it. */
  save: (goals: Goal[]) => void;
  /** Goals being celebrated right now, on whichever page they were met. */
  celebrating: Goal[];
  /** Stamps these goals met today and puts them on screen. */
  celebrate: (met: Goal[], today: string) => void;
  dismiss: () => void;
}

/*
 * One copy for the page, the checklist and the watcher. Each loading its own
 * would let one save over another's stale list — the page deleting a goal and
 * the watcher, a moment later, writing it back with its celebration stamped.
 */
export const useGoals = create<GoalStore>()((set, get) => ({
  goals: [],
  state: "idle",
  load: async () => {
    if (get().state === "loading" || get().state === "ready") return;
    set({ state: "loading" });
    try {
      const d = await getSettings<{ goals?: Goal[] }>("/api/goals");
      set({ goals: d.goals ?? [], state: "ready" });
    } catch {
      set({ state: "failed" });
    }
  },
  save: (goals) => {
    set({ goals });
    saveSettings("/api/goals", { goals }).catch(() => set({ state: "failed" }));
  },
  celebrating: [],
  celebrate: (met, today) => {
    const ids = new Set(met.map((g) => g.id));
    // Stamped before anything is shown, so a reload cannot celebrate it twice.
    get().save(get().goals.map((g) => (ids.has(g.id) ? { ...g, metOn: today } : g)));
    set({ celebrating: [...get().celebrating, ...met] });
  },
  dismiss: () => set({ celebrating: [] }),
}));

/**
 * Everything a goal is measured against, built the way the Overview and Year
 * pages build it, so a goal's figure is the figure those pages show.
 *
 * Null until it can be trusted: the record loaded, not failed, and the
 * month-end history in. Before the history lands the portfolio is an estimate
 * from price history, and a goal judged on an estimate could be celebrated on
 * a figure the record does not support.
 */
export function useGoalInputs(): GoalInputs | null {
  const hydrated = useFinance((s) => s.hydrated);
  const loadError = useFinance((s) => s.loadError);
  const accounts = useFinance((s) => s.accounts);
  const holdings = useFinance((s) => s.holdings);
  const usdCadRate = useFinance((s) => s.usdCadRate);
  const snapshots = useFinance((s) => s.snapshotHistory);
  const historyReady = useFinance((s) => s.snapshotHistoryReady);
  const loadSnapshotHistory = useFinance((s) => s.loadSnapshotHistory);
  const transactions = useIncomeTransactions();
  const spendGroups = useSpendGroups();
  const [limits, setLimits] = useState<ContributionLimits | null>(null);

  useEffect(() => {
    if (hydrated && !loadError) loadSnapshotHistory();
  }, [hydrated, loadError, loadSnapshotHistory]);

  // The room a share-of-room goal is measured against, as the Year page reads it.
  useEffect(() => {
    let cancelled = false;
    getSettings<{ limits?: ContributionLimits }>("/api/contribution-limits")
      .then((d) => !cancelled && setLimits(d.limits ?? {}))
      .catch(() => !cancelled && setLimits({}));
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    if (!hydrated || loadError || !historyReady || limits === null) return null;
    const portfolio =
      portfolioHistory(holdings, snapshots)?.points ?? portfolioSeries(holdings, 18);
    return {
      transactions,
      accounts,
      netWorth: netWorthOver(accounts, portfolio, usdCadRate),
      portfolio,
      limits,
      flowsByMonth: netExternalFlows(holdings),
      spendGroup: (c: string) => groupOf(c, spendGroups),
      // A month is closed once the checklist has recorded its month end.
      isClosed: (month: string) => month in snapshots,
      today: todayISO(),
    };
  }, [
    hydrated,
    loadError,
    historyReady,
    holdings,
    snapshots,
    accounts,
    usdCadRate,
    transactions,
    spendGroups,
    limits,
  ]);
}

/* ── Formatting ── */

export function fmtTarget(goal: Pick<Goal, "metric" | "basis">, n: number): string {
  return specOf(goal.metric, goal.basis).unit === "pct" ? `${Math.round(n * 10) / 10}%` : fmtCAD(n);
}

const STATUS: Record<GoalStatus, { label: string; tone: "neutral" | "positive" | "negative" | "brand" }> = {
  met: { label: "Met", tone: "positive" },
  "on-track": { label: "On track", tone: "brand" },
  behind: { label: "Behind", tone: "negative" },
  missed: { label: "Missed", tone: "negative" },
  awaiting: { label: "Awaiting the checklist", tone: "neutral" },
  upcoming: { label: "Not started", tone: "neutral" },
  "no-data": { label: "No figures yet", tone: "neutral" },
};

/* ── One goal ── */

export function GoalRow({
  progress,
  onDelete,
  highlight = false,
}: {
  progress: GoalProgress;
  onDelete?: () => void;
  /** The goal a celebration linked to, picked out when the page opens on it. */
  highlight?: boolean;
}) {
  const { goal, spec, measure: m, fraction, status } = progress;
  const s = STATUS[status];
  const bar =
    status === "met"
      ? "positive"
      : status === "missed" ||
          ((spec.judge === "stayUnder" || spec.judge === "rateAtMost") && status === "behind")
        ? "negative"
        : undefined;
  return (
    <div
      id={`goal-${goal.id}`}
      className={cn(
        "scroll-mt-24 rounded-xl border border-line bg-elevated/40 p-4 transition-shadow",
        highlight && "ring-2 ring-positive",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full",
            status === "met" ? "bg-positive/15 text-positive" : "bg-brand/10 text-brand",
          )}
        >
          {status === "met" ? <PartyPopper size={15} /> : <Target size={15} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-ink">{describe(goal, fmtCAD)}</p>
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
          {goal.why ? <p className="mt-0.5 text-xs text-ink-faint">{goal.why}</p> : null}
          <div className="mt-3 flex items-center gap-3">
            <Progress value={fraction} max={1} tone={bar ?? "brand"} className="h-2 flex-1" />
            <span className="shrink-0 text-xs tabular-nums text-ink-dim">
              {m.value === null ? "—" : fmtTarget(goal, m.value)}
              <span className="text-ink-faint"> / {fmtTarget(goal, goal.target)}</span>
            </span>
          </div>
          <p className="mt-1.5 text-[0.6875rem] text-ink-faint">
            {goal.metOn
              ? `Met on ${goal.metOn}.`
              : status === "no-data" && goal.metric === "contribution" && goal.basis === "percent"
                ? `Needs ${goal.year}'s contribution room — set it on the Year page.`
                : status === "awaiting"
                  ? `Judged once ${monthName(goal.by)} is closed through the monthly checklist.`
                  : spec.judge === "stayUnder"
                    ? `Spent so far · judged over the whole of it, once ${monthName(goal.by)} is closed.`
                    : spec.judge === "rateAtLeast" || spec.judge === "rateAtMost"
                      ? `So far · judged over the whole of it, once ${monthName(goal.by)} is closed.`
                      : spec.shape === "level"
                        ? "Where it stands now. Met the first month-end it reaches the target."
                        : "Counted so far. Met the moment it reaches the target."}
          </p>
        </div>
        {onDelete ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label={`Delete goal: ${describe(goal, fmtCAD)}`}
            title="Delete goal"
          >
            <Trash2 size={14} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ── Setting one ── */

const MONTH_KEYS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

/**
 * A goal written the SMART way, one question at a time.
 *
 * Specific and measurable are the dropdowns: only figures the app can measure
 * are offered, so every goal set here can be tracked without anything typed in
 * later. Achievable is the figure so far and last year's beside the target,
 * which is the difference between a target and a guess. Relevant is the reason,
 * optional and in the owner's words. Time-bound is the month it is due.
 */
export function GoalComposer({
  year,
  onAdd,
}: {
  year: string;
  onAdd: (goal: Goal) => void;
}) {
  const inputs = useGoalInputs();
  const accounts = useFinance((s) => s.accounts);
  const categories = useFinance((s) => s.categories);
  const [metric, setMetric] = useState<GoalMetric>("saved");
  // Empty is every plan, as an empty category is all spending.
  const [plan, setPlan] = useState<RegisteredPlan | "">("");
  const [category, setCategory] = useState("");
  const [basis, setBasis] = useState<GoalBasis>("amount");
  const [target, setTarget] = useState("");
  const [by, setBy] = useState("12");
  const [why, setWhy] = useState("");
  const [error, setError] = useState("");

  const spec = specOf(metric, basis);
  const def = METRICS.find((m) => m.metric === metric) ?? METRICS[0];
  const pct = spec.unit === "pct";
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const draft = {
    metric,
    basis,
    year,
    by: `${year}-${by}`,
    plan: metric === "contribution" && plan ? plan : undefined,
    category: metric === "spending" && category ? category : undefined,
  };

  /*
   * The two figures that make a target achievable rather than a guess: where
   * it stands this year, and where it ended last year.
   */
  const soFar = inputs && year <= thisMonth.slice(0, 4) ? measure(draft, inputs).value : null;
  const lastYear = inputs
    ? measure({ ...draft, year: String(Number(year) - 1), by: `${Number(year) - 1}-12` }, inputs)
        .value
    : null;

  const amount = Number(target.replace(/[$,\s%]/g, ""));
  const valid = target.trim() !== "" && Number.isFinite(amount) && amount >= 0;
  const monthsLeft = Math.max(
    1,
    Number(by) - (year === thisMonth.slice(0, 4) ? Number(thisMonth.slice(5)) - 1 : 0),
  );

  /*
   * A share of room needs the room. Said before the goal is set, not after:
   * otherwise it is added, reads "no figures yet", and nobody knows why.
   */
  const room = inputs?.limits[year] ?? {};
  const noRoom =
    metric === "contribution" &&
    pct &&
    inputs !== null &&
    !(draft.plan ? [draft.plan] : REGISTERED_PLANS).some((p) => (room[p] ?? 0) > 0);

  let pace: string | null = null;
  if (valid) {
    if (spec.judge === "reach" && soFar !== null && soFar >= amount) {
      pace = "Already there — the goal would be met the moment it is saved. Aim higher?";
    } else if (spec.judge === "reduceTo" && soFar !== null && soFar <= amount) {
      pace = "Already there — the goal would be met the moment it is saved.";
    } else if (pct && spec.judge === "reach" && soFar !== null) {
      pace = `${Math.round((amount - soFar) * 10) / 10} percentage points to go.`;
    } else if (pct) {
      pace = null;
    } else if (spec.judge === "reach" && spec.shape === "flow") {
      pace = `About ${fmtCAD((amount - (soFar ?? 0)) / monthsLeft)} a month from here.`;
    } else if (spec.judge === "stayUnder") {
      pace = `About ${fmtCAD(Math.max(0, amount - (soFar ?? 0)) / monthsLeft)} a month left to spend.`;
    } else if (spec.shape === "level" && soFar !== null) {
      pace = `${fmtCAD(Math.abs(amount - soFar))} to go.`;
    }
  }

  const add = () => {
    if (!valid) {
      setError(pct ? "Enter the target as a percentage." : "Enter the target as an amount.");
      return;
    }
    if (pct && amount > (spec.max ?? 100)) {
      setError(`That cannot be more than ${spec.max ?? 100}%.`);
      return;
    }
    if (amount === 0 && spec.judge !== "reduceTo") {
      setError("A target of nothing is met before it starts.");
      return;
    }
    onAdd({
      id: uid(),
      ...draft,
      target: pct ? Math.round(amount * 10) / 10 : Math.round(amount * 100) / 100,
      why: why.trim() || undefined,
      createdAt: today,
    });
    setTarget("");
    setWhy("");
    setError("");
  };

  const preview = valid
    ? describe({ id: "", createdAt: "", target: amount, ...draft }, fmtCAD)
    : null;

  return (
    <div className="space-y-5">
      <Step letter="S" title="Specific" hint={spec.source}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What to measure">
            <Select value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)}>
              <optgroup label="Where things stand">
                {METRICS.filter((m) => m.amount.shape === "level").map((m) => (
                  <option key={m.metric} value={m.metric}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={`Over ${year}`}>
                {METRICS.filter((m) => m.amount.shape === "flow").map((m) => (
                  <option key={m.metric} value={m.metric}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field label="Set as">
            <Select value={basis} onChange={(e) => setBasis(e.target.value as GoalBasis)}>
              <option value="amount">{def.amount.option}</option>
              <option value="percent">{def.percent.option}</option>
            </Select>
          </Field>
          {metric === "contribution" ? (
            <Field label="Which plan">
              <Select value={plan} onChange={(e) => setPlan(e.target.value as RegisteredPlan | "")}>
                <option value="">All plans</option>
                {REGISTERED_PLANS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                    {accounts.some((a) => a.registration === p) ? "" : " (no account yet)"}
                  </option>
                ))}
              </Select>
            </Field>
          ) : metric === "spending" ? (
            <Field label="On what">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All spending</option>
                {[...categories].sort().map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      </Step>

      {metric === "donations" && !categories.includes(DONATIONS_CATEGORY) ? (
        <p className="-mt-2 ml-9 text-[0.6875rem] text-ink-dim">
          There is no {DONATIONS_CATEGORY} category yet. Gifts to charity count once they are
          recorded under one — an import files a bank&rsquo;s charity rows there on its own.
        </p>
      ) : null}
      {noRoom ? (
        <p className="-mt-2 ml-9 text-[0.6875rem] text-ink-dim">
          No contribution room is set for {year} yet, so there is nothing to take a share of. Set it
          on the Year page, or in the January checklist.
        </p>
      ) : null}

      <Step letter="M" title="Measurable">
        <Field label={spec.field}>
          <Input
            inputMode="decimal"
            placeholder={pct ? "e.g. 10" : metric === "donations" ? "e.g. 2000" : "e.g. 10000"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
      </Step>

      <Step letter="A" title="Achievable">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <p>
            <span className="text-ink-faint">So far in {year}: </span>
            <span className="font-medium tabular-nums text-ink">
              {soFar === null ? "—" : fmtTarget(draft, soFar)}
            </span>
          </p>
          <p>
            <span className="text-ink-faint">{Number(year) - 1}: </span>
            <span className="font-medium tabular-nums text-ink">
              {lastYear === null ? "—" : fmtTarget(draft, lastYear)}
            </span>
          </p>
        </div>
        {pace ? <p className="mt-1.5 text-xs text-ink-dim">{pace}</p> : null}
      </Step>

      <Step letter="R" title="Relevant">
        <Field label="Why it matters (optional)">
          <Input
            maxLength={280}
            placeholder="e.g. A deposit for a place of our own"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />
        </Field>
      </Step>

      <Step letter="T" title="Time-bound">
        <Field
          label={spec.judge === "stayUnder" || spec.judge === "rateAtLeast" ? "Over January to" : "By the end of"}
        >
          <Select value={by} onChange={(e) => setBy(e.target.value)}>
            {MONTH_KEYS.map((m) => (
              <option key={m} value={m} disabled={`${year}-${m}` < thisMonth}>
                {monthName(`${year}-${m}`)} {year}
              </option>
            ))}
          </Select>
        </Field>
      </Step>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="min-w-0 flex-1 text-sm text-ink-dim">
          {preview ? (
            <>
              <span className="text-ink-faint">Goal: </span>
              <span className="font-medium text-ink">{preview}</span>
            </>
          ) : (
            <span className="text-ink-faint">Pick a measure and a target to see the goal.</span>
          )}
        </p>
        <Button onClick={add}>
          <Plus size={14} /> Add goal
        </Button>
      </div>
      {error ? <p className="text-xs text-negative">{error}</p> : null}
    </div>
  );
}

function Step({
  letter,
  title,
  hint,
  children,
}: {
  letter: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand/10 text-xs font-semibold text-brand"
      >
        {letter}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-xs font-medium text-ink-dim">{title}</p>
        {children}
        {hint ? <p className="mt-1.5 text-[0.6875rem] text-ink-faint">{hint}</p> : null}
      </div>
    </div>
  );
}

/* ── Celebrating one ── */

const CONFETTI_COLOURS = ["#f6cb6e", "#e3aec4", "#a877e2", "#7c30e6", "#34d399", "#60a5fa"];

/** A burst of confetti across the whole window, gone in a few seconds. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Two cannons from the lower corners, aimed up and in.
    const pieces = Array.from({ length: 220 }, (_, i) => {
      const left = i % 2 === 0;
      const angle = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7;
      const speed = 9 + Math.random() * 9;
      return {
        x: left ? 0 : w,
        y: h * 0.85,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 6,
        spin: Math.random() * Math.PI,
        spinV: (Math.random() - 0.5) * 0.3,
        colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
        round: Math.random() < 0.3,
      };
    });

    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      const fade = t > 3200 ? Math.max(0, 1 - (t - 3200) / 900) : 1;
      for (const p of pieces) {
        p.vy += 0.25;
        p.vx *= 0.99;
        p.vy *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.spinV;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.colour;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Squashed by the spin, so each piece looks like it is tumbling.
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.spin)) + 1);
        }
        ctx.restore();
      }
      if (fade > 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] h-full w-full"
    />
  );
}

/**
 * A short bright chime: a major arpeggio up, then the chord held.
 *
 * Synthesised rather than loaded, so there is no file to fetch and nothing to
 * license. A browser that has not yet seen the page touched may refuse to play
 * sound at all; that is the browser's call, and the confetti and the message
 * say the same thing without it.
 */
function playChime() {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return;
  }
  void ctx.resume().catch(() => {});
  const master = ctx.createGain();
  master.gain.value = 0.16;
  master.connect(ctx.destination);

  const note = (freq: number, at: number, length: number, level = 1) => {
    for (const [type, mult, gain] of [
      ["triangle", 1, level],
      ["sine", 2, level * 0.22],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + length);
      osc.connect(g).connect(master);
      osc.start(at);
      osc.stop(at + length + 0.05);
    }
  };

  const t = ctx.currentTime + 0.03;
  // C5 E5 G5 C6, then the chord held under a high E.
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, t + i * 0.09, 0.5, 0.8));
  [523.25, 659.25, 783.99].forEach((f) => note(f, t + 0.42, 1.3, 0.45));
  note(1318.5, t + 0.42, 1.1, 0.35);
  window.setTimeout(() => void ctx.close().catch(() => {}), 2500);
}

/**
 * Watches for goals the record now shows met, and celebrates them once.
 *
 * Mounted by the shell, so a goal met by a checklist, an import or a price
 * refresh is celebrated on whichever page it happens. Each goal is stamped
 * with the day it was first seen met before anything is shown, which is what
 * stops a reload from celebrating it again.
 */
export function GoalWatcher() {
  if (!SHOW_UNRELEASED) return null;
  return <Watcher />;
}

function Watcher() {
  const router = useRouter();
  const inputs = useGoalInputs();
  const goals = useGoals((s) => s.goals);
  const state = useGoals((s) => s.state);
  const load = useGoals((s) => s.load);
  const celebrate = useGoals((s) => s.celebrate);
  const met = useGoals((s) => s.celebrating);
  const close = useGoals((s) => s.dismiss);

  useEffect(() => {
    if (inputs) void load();
  }, [inputs, load]);

  useEffect(() => {
    if (!inputs || state !== "ready") return;
    const fresh = newlyMet(goals, inputs);
    if (fresh.length === 0) return;
    celebrate(fresh, inputs.today);
    playChime();
  }, [inputs, state, goals, celebrate]);

  if (met.length === 0) return null;
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <>
      {reduceMotion ? null : <Confetti />}
      <Modal open onClose={close} title={met.length === 1 ? "Goal reached" : `${met.length} goals reached`}>
        <div className="flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-positive/15 text-positive">
            <PartyPopper size={26} />
          </div>
          <p className="mt-3 text-base font-semibold text-ink">
            You did it.
          </p>
          <ul className="mt-2 space-y-1">
            {met.map((g) => (
              <li key={g.id} className="text-sm text-ink-dim">
                {describe(g, fmtCAD)}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          <Button
            onClick={() => {
              close();
              router.push(`/goals#goal-${met[0].id}`);
            }}
          >
            See it on the goals page
          </Button>
        </div>
      </Modal>
    </>
  );
}
