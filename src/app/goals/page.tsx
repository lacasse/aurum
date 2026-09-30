"use client";

import { useEffect, useMemo, useState } from "react";
import { Target } from "lucide-react";
import { Shell } from "@/components/shell";
import { Card, CardHeader, EmptyState, Segmented } from "@/components/ui";
import { ConfirmDelete } from "@/components/forms";
import { GoalComposer, GoalRow, useGoalInputs, useGoals } from "@/components/goals";
import { PageSkeleton, useReady } from "@/lib/hooks";
import { describe, progressOf, type Goal, type GoalProgress, type GoalStatus } from "@/lib/goals";
import { fmtCAD, todayISO } from "@/lib/format";

/** Goals still in play first, then the ones settled either way. */
const ORDER: Record<GoalStatus, number> = {
  behind: 0,
  "on-track": 1,
  "no-data": 2,
  awaiting: 3,
  upcoming: 4,
  met: 5,
  missed: 6,
};

/**
 * A year's goals, and how far along each one is.
 *
 * Every goal is measured against a figure the app already keeps, by the same
 * rule the page that shows that figure uses — there is nothing to update by
 * hand. A goal is met the first time the record shows it met, and stays met.
 */
export default function GoalsPage() {
  const ready = useReady();
  const inputs = useGoalInputs();
  const goals = useGoals((s) => s.goals);
  const state = useGoals((s) => s.state);
  const load = useGoals((s) => s.load);
  const save = useGoals((s) => s.save);
  const thisYear = todayISO().slice(0, 4);
  const [year, setYear] = useState(thisYear);
  const [deleting, setDeleting] = useState<Goal | null>(null);

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

  const met = progress?.filter((p) => p.status === "met").length ?? 0;
  const count = progress?.length ?? 0;

  return (
    <Shell
      title="Goals"
      subtitle={
        count > 0 ? `${met} of ${count} met in ${year}` : `What ${year} is for, and how far along it is`
      }
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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Card>
          <CardHeader
            title={`Goals for ${year}`}
            subtitle="Measured from your own record, and updated as it changes"
          />
          <div className="space-y-3 px-5 pb-5">
            {state === "failed" ? (
              /*
               * Said, not hidden: an empty list here would read as having no
               * goals, when the truth is that they could not be read.
               */
              <p className="rounded-lg border border-negative/30 bg-negative/5 p-4 text-sm text-negative">
                Your goals could not be read. Nothing has been changed — reload the page to try again.
              </p>
            ) : state !== "ready" || progress === null ? (
              <p className="py-10 text-center text-xs text-ink-faint">Measuring…</p>
            ) : progress.length === 0 ? (
              <EmptyState
                icon={<Target size={22} />}
                title={`No goals for ${year} yet`}
                subtitle={
                  year >= thisYear
                    ? "Set one with the form on this page."
                    : "Nothing was set for that year."
                }
              />
            ) : (
              progress.map((p) => (
                <GoalRow
                  key={p.goal.id}
                  progress={p}
                  highlight={p.goal.id === linked}
                  onDelete={() => setDeleting(p.goal)}
                />
              ))
            )}
          </div>
        </Card>

        {/* Only once the list has loaded: adding to an unread list would save over it. */}
        {year >= thisYear && state === "ready" ? (
          <Card>
            <CardHeader
              title="Set a goal"
              subtitle="Specific, measurable, achievable, relevant and time-bound"
            />
            <div className="px-5 pb-5">
              <GoalComposer
                year={year}
                onAdd={(goal) => save([...useGoals.getState().goals, goal])}
              />
            </div>
          </Card>
        ) : null}
      </div>

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
