"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, cn } from "@/components/ui";
import { getSettings, saveSettings } from "@/lib/api";

/*
 * Cards that can be put away from the page they sit on, and brought back
 * here. Hiding one only stops it being shown: whatever it was set up with is
 * kept, so turning it back on finds it as it was left.
 *
 * The expense settings are saved as one object, so this reads the whole of it
 * and writes it back with the one flag changed, never a partial copy.
 */
export function PageSettings() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSettings<Record<string, unknown>>("/api/expense-settings")
      .then((s) => {
        if (!cancelled) setSettings({ groups: {}, car: null, ...s });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const carShown = settings ? settings.carHidden !== true : true;
  const setCarShown = (shown: boolean) => {
    if (!settings) return;
    const next = { ...settings, carHidden: !shown };
    setSettings(next);
    saveSettings("/api/expense-settings", next).catch(() => {});
  };

  return (
    <Card>
      <CardHeader title="Pages" subtitle="Cards you can hide, and bring back here" />
      <div className="px-5 pb-5">
        <label className="flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
          <span>
            <span className="block text-sm font-medium">What the car costs</span>
            <span className="block text-xs text-ink-faint">
              On the Expenses page. Hiding it keeps what it was set up with.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={carShown}
            disabled={!settings}
            onClick={() => setCarShown(!carShown)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0 transition-colors disabled:opacity-50",
              carShown ? "bg-brand" : "bg-elevated ring-1 ring-inset ring-line",
            )}
          >
            <span
              className={cn(
                "absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                carShown ? "translate-x-[1.125rem]" : "translate-x-0.5",
              )}
            />
            <span className="sr-only">Show on the Expenses page</span>
          </button>
        </label>
      </div>
    </Card>
  );
}
