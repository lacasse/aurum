"use client";

import { ReactNode } from "react";
import { Badge, Card } from "./ui";
import { Sparkline } from "./charts";

export function StatCard({
  label,
  value,
  delta,
  deltaValue,
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
        {deltaValue ? (
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
