"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { useFinance } from "@/lib/store";
import { AccountSettings } from "@/components/account-settings";
import { MarketDataKeys } from "@/components/market-data-keys";
import { PeopleSettings } from "@/components/people-settings";
import { StartOver } from "@/components/start-over";
import { PageSettings } from "@/components/page-settings";

/**
 * Settings, in the order they are reached for: how you sign in, the keys your
 * prices come from, which cards the pages show, who else uses this
 * installation (administrators only), and last, set apart, deleting your
 * record.
 *
 * In the demo only the keys and pages cards show: there is no account to
 * change and nothing on the server to delete.
 */
export default function SettingsPage() {
  const demo = useFinance((s) => s.demo);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { role?: string } | null) => {
        if (!cancelled) setIsAdmin(me?.role === "admin");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [demo]);

  return (
    <Shell title="Settings" subtitle="Your account, your market-data keys and your record">
      <div className="space-y-4">
        {demo ? null : <AccountSettings />}
        <MarketDataKeys demo={demo} />
        <PageSettings />
        {isAdmin && !demo ? <PeopleSettings /> : null}
        {demo ? null : <StartOver />}
      </div>
    </Shell>
  );
}
