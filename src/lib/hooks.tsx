"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * True once running on the client. Uses useSyncExternalStore so SSR and the
 * hydrating render both see `false` without needing setState-in-effect.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/** Gate for pages that read localStorage-backed state: skeleton until client-side. */
export function useReady(): boolean {
  return useMounted();
}

export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-2xl border border-line bg-surface" />
        ))}
      </div>
      <div className="h-80 rounded-2xl border border-line bg-surface" />
      <div className="h-72 rounded-2xl border border-line bg-surface" />
    </div>
  );
}
