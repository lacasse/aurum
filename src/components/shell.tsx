"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import {
  ArrowLeftRight,
  Landmark,
  LayoutDashboard,
  Menu,
  Moon,
  Sun,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  UploadCloud,
  Wallet,
  X,
  LogOut,
} from "lucide-react";
import { Button, Modal } from "./ui";
import { useFinance } from "@/lib/store";
import { useMounted } from "@/lib/hooks";
import { cn } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/investments", label: "Investments", icon: TrendingUp },
  { href: "/budgets", label: "Budgets", icon: Target },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/import", label: "Import CSV", icon: Upload },
  { href: "/import-trades", label: "Import trades", icon: UploadCloud },
] as const;

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  if (!mounted) {
    return <Button variant="ghost" size="icon" aria-label="Toggle theme" />;
  }
  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </Button>
  );
}

/**
 * Offers a one-time cleanup of the sample data the app seeds on first deploy.
 * It disappears for good once that data is gone — there is nothing left to
 * delete, and the server will not seed it again.
 */
function DeleteDemo() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const demoPresent = useFinance((s) => s.demoPresent);
  const deleteDemo = useFinance((s) => s.deleteDemo);

  if (!demoPresent) return null;

  const close = () => {
    setOpen(false);
    setError("");
  };

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      await deleteDemo();
      setOpen(false);
    } catch {
      setError("Could not delete the demo data. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-ink-faint transition-colors hover:bg-elevated hover:text-ink-dim"
      >
        <Trash2 size={14} />
        Delete demo data
      </button>
      <Modal open={open} onClose={close} title="Delete demo data">
        <p className="text-sm text-ink-dim">
          This permanently removes the sample accounts, transactions, holdings
          and budgets that came with the app. Anything you have added yourself
          is kept, as is your category list. This cannot be undone.
        </p>
        {error ? <p className="mt-3 text-sm text-negative">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={run} disabled={busy}>
            {busy ? "Deleting…" : "Delete demo data"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-3 py-1"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-violet-500/20">
          <Wallet size={18} />
        </span>
        <span>
          <span className="block text-sm font-semibold tracking-tight">Aurum</span>
          <span className="block text-[11px] text-ink-faint">Personal Finance</span>
        </span>
      </Link>

      <nav className="mt-6 flex-1 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand/10 text-brand"
                  : "text-ink-dim hover:bg-elevated hover:text-ink",
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-line pt-3">
        <div className="flex items-center justify-between px-3 pb-1">
          <span className="text-[11px] uppercase tracking-wider text-ink-faint">
            Theme
          </span>
          <ThemeToggle />
        </div>
        <DeleteDemo />
        <button
          onClick={logout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-ink-faint transition-colors hover:bg-elevated hover:text-ink-dim"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </div>
  );
}

export function Shell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-surface p-4 lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onMouseDown={(e) => e.target === e.currentTarget && setMobileOpen(false)}
        >
          <div className="animate-fade-up h-full w-64 border-r border-line bg-surface p-4">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col lg:ml-60">
        <header className="sticky top-0 z-20 border-b border-line bg-background/80 backdrop-blur-md">
          <div className="flex items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={18} />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {title}
              </h1>
              {subtitle ? (
                <p className="truncate text-xs text-ink-faint">{subtitle}</p>
              ) : null}
            </div>
            {action}
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
        <footer className="px-6 pb-6 pt-2 text-center text-[11px] text-ink-faint">
          Aurum · data stored in PostgreSQL via Docker · not financial advice
        </footer>
      </div>

      {/* Close button floating for mobile drawer */}
      {mobileOpen ? (
        <button
          aria-label="Close menu"
          className="fixed right-4 top-4 z-50 rounded-full bg-surface p-2 shadow lg:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}
