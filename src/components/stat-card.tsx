"use client";

import { ReactNode } from "react";
import { Badge, Card } from "./ui";
import { Sparkline } from "./charts";

export function StatCard({
  label,
  value,
  delta,
  deltaValue,
  deltaDir,
  deltaLabel,
  icon,
  tone = "neutral",
  spark,
  sparkKey,
  sparkColor = "#8b5cf6",
}: {
  label: string;
  value: string;
  delta?: number; // percent
  /** The same move in money, shown beside the percentage. */
  deltaValue?: string;
  /**
   * Which way `deltaValue` moved, when it is a move rather than a caption.
   *
   * Set it and the figure gets the badge the percentage would have had —
   * tinted box, arrow, the lot. The direction is separate from the tone on
   * purpose: spending less is a fall *and* good news, so the arrow points
   * down while the box stays green.
   */
  deltaDir?: "up" | "down";
  deltaLabel?: string;
  icon?: ReactNode;
  tone?: "neutral" | "positive" | "negative";
  spark?: Record<string, unknown>[];
  sparkKey?: string;
  sparkColor?: string;
}) {
  const positive = (delta ?? 0) >= 0;
  return (
    <Card className="relative overflow-hidden p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-dim">{label}</span>
        {icon ? <span className="text-ink-faint">{icon}</span> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {delta !== undefined ? (
          <Badge tone={tone === "neutral" ? (positive ? "positive" : "negative") : tone}>
            {positive ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </Badge>
        ) : null}
        {deltaValue && deltaDir ? (
          <Badge tone={tone === "neutral" ? "neutral" : tone}>
            {deltaDir === "up" ? "▲" : "▼"}{" "}
            <span className="tabular-nums">{deltaValue}</span>
          </Badge>
        ) : deltaValue ? (
          /*
           * No direction given, so this is a caption rather than a move — "3
           * disposals", "of net worth" — and it stays plain text in the muted
           * ink rather than pretending to be a change.
           */
          <span className="text-[0.6875rem] font-medium tabular-nums text-ink-dim">
            {deltaValue}
          </span>
        ) : null}
        {deltaLabel ? (
          <span className="text-[0.6875rem] text-ink-faint">{deltaLabel}</span>
        ) : null}
      </div>
      {spark && spark.length > 1 && sparkKey ? (
        <div className="mt-3 -mb-1 opacity-80">
          <Sparkline data={spark} dataKey={sparkKey} color={sparkColor} height={64} />
        </div>
      ) : null}
    </Card>
  );
}
