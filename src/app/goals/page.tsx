"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, Target, X } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, Card, CardHeader, EmptyState, Modal, Segmented, cn } from "@/components/ui";
import { ConfirmDelete } from "@/components/forms";
import {
  GoalCard,
  GoalComposer,
  GoalIdeas,
  useGoalInputs,
  useGoals,
  type GoalPreset,
} from "@/components/goals";
import { PageSkeleton, useReady } from "@/lib/hooks";
import {
  describe,
  isWholeWindow,
  progressOf,
  type Goal,
  type GoalProgress,
  type GoalStatus,
} from "@/lib/goals";
import { fmtCAD, todayISO } from "@/lib/format";

/** Goals still in play first, the ones that need a push at the top. */
const ORDER: Record<GoalStatus, number> = {
  behind: 0,
  "on-track": 1,
  open: 1,
  "no-data": 2,
  awaiting: 3,
  upcoming: 4,
  missed: 5,
  met: 6,
};

const DAY = 86_400_000;

/**
 * A year's goals, and how far along each one is.
 *
 * Every goal is measured against a figure the app already keeps, by the same
 * rule the page that shows that figure uses — there is nothing to update by
 * hand. A goal is met the first time the record shows it met, and stays met.
 *
 * The year's ring counts the goals going well, beside the time left to bring
 * the rest round; each goal below it carries its measure's icon and its own
 * bar, so a goal is recognised by its shape before it is read.
 */
export default function GoalsPage() {
  const ready = useReady();
  const inputs = useGoalInputs();
  const goals = useGoals((s) => s.goals);
  const state = useGoals((s) => s.state);
  const load = useGoals((s) => s.load);
  const save = useGoals((s) => s.save);
  const today = todayISO();
  const thisYear = today.slice(0, 4);
  const [year, setYear] = useState(thisYear);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [editing, setEditing] = useState<Goal | null>(null);
  // The form is shown once something has been picked to start it from.
  const [composing, setComposing] = useState<{ key: number; preset?: GoalPreset } | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * This year and next, so the coming year can be planned in December, and
   * any year that already has goals in it.
   */
  const years = useMemo(
    () =>
      [...new Set([thisYear, String(Number(thisYear) + 1), ...goals.map((g) => g.year)])]
        .sort()
        .reverse(),
    [goals, thisYear],
  );

  const progress = useMemo<GoalProgress[] | null>(() => {
    if (!inputs) return null;
    return goals
      .filter((g) => g.year === year)
      .map((g) => progressOf(g, inputs))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  }, [goals, inputs, year]);

  /*
   * A celebration links here as /goals#goal-<id>. The goal is not on the page
   * until it has been measured, so the browser's own jump to it finds nothing;
   * this picks it out and scrolls to it once it is.
   */
  const linked =
    typeof window !== "undefined" && window.location.hash.startsWith("#goal-")
      ? window.location.hash.slice("#goal-".length)
      : null;
  useEffect(() => {
    if (!linked || !progress) return;
    document.getElementById(`goal-${linked}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [linked, progress]);

  if (!ready) return <PageSkeleton />;

  // Only once the list has loaded: adding to an unread list would save over it.
  const canSet = year >= thisYear && state === "ready";
  const start = (preset?: GoalPreset) =>
    setComposing((c) => ({ key: (c?.key ?? 0) + 1, preset }));

  return (
    <Shell
      title="Goals"
      subtitle={`What ${year} is for, and how far along it is`}
      action={
        years.length > 1 ? (
          <Segmented
            options={years.map((y) => ({ value: y, label: y }))}
            value={year}
            onChange={setYear}
          />
        ) : null
      }
    >
      <div className="space-y-4">
        {state === "failed" ? (
          /*
           * Said, not hidden: an empty list here would read as having no
           * goals, when the truth is that they could not be read.
           */
          <Card className="border-negative/30 bg-negative/5 p-5">
            <p className="text-sm text-negative">
              Your goals could not be read. Nothing has been changed — reload the page to try again.
            </p>
          </Card>
        ) : state !== "ready" || progress === null ? (
          <Card className="p-10">
            <p className="text-center text-xs text-ink-faint">Measuring…</p>
          </Card>
        ) : (
          <>
            <Summary progress={progress} year={year} today={today} />

            {progress.length > 0 ? (
              <div>
                <div className="grid gap-3 md:grid-cols-2">
                  {progress.map((p) => (
                    <GoalCard
                      key={p.goal.id}
                      progress={p}
                      highlight={p.goal.id === linked}
                      onEdit={() => setEditing(p.goal)}
                      onDelete={() => setDeleting(p.goal)}
                    />
                  ))}
                </div>
                {/*
                  * How a goal is judged, said once for the list rather than on
                  * every card that it applies to.
                  */}
                {progress.some((p) => isWholeWindow(p.spec.judge) && p.goal.metric !== "custom") ? (
                  <p className="mt-3 px-1 text-[0.6875rem] text-ink-faint">
                    A share of income or spending, and a cap on spending, is judged over the whole of
                    its months once the last of them is closed through the monthly checklist.
                    Everything else is met the moment the record shows it.
                  </p>
                ) : null}
              </div>
            ) : (
              <Card>
                <EmptyState
                  icon={<Target size={22} />}
                  title={`No goals for ${year} yet`}
                  subtitle={
                    year >= thisYear
                      ? "Pick an idea below, or start one of your own."
                      : "Nothing was set for that year."
                  }
                />
              </Card>
            )}
          </>
        )}

        {canSet ? (
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles size={14} className="text-brand" /> A new goal for {year}
                </span>
              }
              subtitle={
                composing
                  ? "Specific, measurable, achievable, relevant and time-bound"
                  : "Start from an idea, or from scratch"
              }
              action={
                composing ? (
                  <Button variant="ghost" size="sm" onClick={() => setComposing(null)}>
                    <X size={13} /> Back to ideas
                  </Button>
                ) : null
              }
            />
            <div className="px-5 pb-5">
              {composing ? (
                <GoalComposer
                  key={composing.key}
                  preset={composing.preset}
                  year={year}
                  wide
                  onAdd={(goal) => {
                    save([...useGoals.getState().goals, goal]);
                    setComposing(null);
                  }}
                />
              ) : (
                <GoalIdeas onPick={(p) => start(p)} onScratch={() => start()} />
              )}
            </div>
          </Card>
        ) : null}
      </div>

      {/* The same form as setting one, filled in with the goal as it stands. */}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit goal" size="xl">
        {editing ? (
          <GoalComposer
            key={editing.id}
            year={editing.year}
            editing={editing}
            onAdd={(changed) => {
              save(useGoals.getState().goals.map((g) => (g.id === changed.id ? changed : g)));
              setEditing(null);
            }}
          />
        ) : null}
      </Modal>

      <ConfirmDelete
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          save(useGoals.getState().goals.filter((g) => g.id !== deleting.id));
        }}
        title="Delete this goal?"
        message={deleting ? `${describe(deleting, fmtCAD)}. This cannot be undone.` : ""}
      />
    </Shell>
  );
}

/**
 * The year at a glance: a ring of the goals going well, a verdict in words,
 * the counts, and the days left.
 */
function Summary({
  progress,
  year,
  today,
}: {
  progress: GoalProgress[];
  year: string;
  today: string;
}) {
  const total = progress.length;
  const count = (s: GoalStatus) => progress.filter((p) => p.status === s).length;
  const met = count("met");
  const onTrack = count("on-track");
  const open = count("open");
  const behind = count("behind");
  const awaiting = count("awaiting");
  const missed = count("missed");

  // A verdict in words; the chips beside it carry the numbers.
  const headline =
    total === 0
      ? "A blank slate. What should this year be for?"
      : met === total
        ? "Every goal met. Take a bow."
        : behind === 0 && missed === 0
          ? "Everything on track. Keep going."
          : behind > 0
            ? "A good year, with some pushing left to do."
            : "Some didn't land, and the rest are on course.";

  // The year's clock, by the day.
  const y = Number(year);
  const [ty, tm, td] = today.split("-").map(Number);
  const now = Date.UTC(ty, tm - 1, td);
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  const clock =
    now < start
      ? { n: Math.ceil((start - now) / DAY), label: `days until ${year}` }
      : now >= end
        ? { n: "Done", label: `${year} is over` }
        : { n: Math.ceil((end - now) / DAY), label: `days left in ${year}` };

  /*
   * The ring counts goals met or on track, not only met. A share of income or
   * a cap on spending is judged once the year closes, so a ring of met goals
   * sat empty all year for them however well they were going.
   */
  const good = met + onTrack;

  const chips: { label: string; n: number; tone: string }[] = [
    { label: "met", n: met, tone: "bg-positive/10 text-positive" },
    { label: "on track", n: onTrack, tone: "bg-brand/10 text-brand" },
    { label: "behind", n: behind, tone: "bg-negative/10 text-negative" },
    { label: "to do", n: open, tone: "bg-brand/10 text-brand" },
    { label: "awaiting the checklist", n: awaiting, tone: "bg-elevated text-ink-dim" },
    { label: "missed", n: missed, tone: "bg-elevated text-ink-faint" },
  ];

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <Ring value={good} total={total} label="on track" />
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-lg font-semibold tracking-tight text-ink">{headline}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {chips
              .filter((c) => c.n > 0)
              .map((c) => (
                <span
                  key={c.label}
                  className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums", c.tone)}
                >
                  {c.n} {c.label}
                </span>
              ))}
          </div>
        </div>
        {/*
          * The time left, as a figure. The ring says how many goals are going
          * well; this says how long there is to bring the rest round.
          */}
        <div className="flex shrink-0 items-baseline gap-2 border-line sm:block sm:border-l sm:pl-6 sm:text-right">
          <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink">{clock.n}</p>
          <p className="text-xs text-ink-faint">{clock.label}</p>
        </div>
      </div>
    </Card>
  );
}

/** Goals met or on track, as a ring that fills. */
function Ring({ value, total, label }: { value: number; total: number; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const share = total > 0 ? value / total : 0;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className="stroke-elevated" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className="stroke-positive transition-[stroke-dashoffset] duration-700"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - share)}
          opacity={share > 0 ? 1 : 0}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-xl font-semibold tabular-nums leading-none text-ink">
            {value}
            <span className="text-sm text-ink-faint">/{total}</span>
          </p>
          <p className="mt-1 text-[0.625rem] uppercase tracking-wider text-ink-faint">{label}</p>
        </div>
      </div>
    </div>
  );
}
