"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  BookOpen,
  CalendarRange,
  HandCoins,
  Landmark,
  LayoutDashboard,
  Palette,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Receipt,
  ReceiptText,
  Sun,
  Trash2,
  TrendingUp,
  Upload,
  X,
  LogOut,
} from "lucide-react";
import { Button, Modal } from "./ui";
import { useFinance } from "@/lib/store";
import { useMounted } from "@/lib/hooks";
import { cn } from "./ui";

/*
 * Ordered by how the money is read rather than how it is entered: the summary
 * first, then the three questions it raises — what came in, what went out,
 * what it bought — and then the ledger those are all derived from. The
 * transaction list is the raw material, so it sits under the pages that
 * interpret it rather than above them.
 *
 * Import and the guide sit at the foot, below the pages that answer something:
 * one is a thing you do a few times a month, the other a thing you read once.
 */
const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/income", label: "Income", icon: HandCoins },
  { href: "/expenses", label: "Expenses", icon: ReceiptText },
  { href: "/investments", label: "Investments", icon: TrendingUp },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/year", label: "Year", icon: CalendarRange },
  { href: "/tax", label: "Tax", icon: Receipt, unreleased: true },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/guide", label: "Guide", icon: BookOpen, unreleased: true },
  /* Temporary: the colour-picking bench. Delete this line with the page. */
  { href: "/colours", label: "Colours", icon: Palette, unreleased: true },
] as const;

/**
 * Whether pages still being worked on are listed.
 *
 * `unreleased: true` above keeps a page out of the sidebar of a built app
 * while leaving it exactly where it was in development, so work carries on
 * without a branch to maintain or a revert to re-apply. Promoting a page is
 * deleting one word.
 *
 * This hides rather than disables: the route is still built and still answers
 * to its URL. That is deliberate — it is how a page is checked in the real app
 * before it is promoted — so it is not a way to keep anything secret, only a
 * way to keep an unfinished page from being offered as though it were done.
 *
 * Read at module scope because Next replaces `process.env.NEXT_PUBLIC_*` at
 * build time; there is nothing to re-evaluate per render.
 */
const SHOW_UNRELEASED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_SHOW_UNRELEASED === "1";

const VISIBLE_NAV = NAV.filter((item) => SHOW_UNRELEASED || !("unreleased" in item));

/** Just the disc, for the collapsed rail. Same gradient, no wordmark. */
function AurumMark() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="nav-mark h-8 w-8"
      role="img"
      aria-label="Aurum"
    >
      <defs>
        <linearGradient id="aurum-mark-small" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6cb6e" />
          <stop offset="0.34" stopColor="#e3aec4" />
          <stop offset="0.66" stopColor="#a877e2" />
          <stop offset="1" stopColor="#7c30e6" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill="url(#aurum-mark-small)" />
    </svg>
  );
}

/**
 * The whole lockup, drawn rather than loaded.
 *
 * As one SVG it stays sharp at any size and costs no request.
 *
 * The disc keeps the logo's gradient exactly: gold at the top left through to
 * the brand violet at the bottom right, which is where the app's two colours
 * come from.
 */

function AurumLogo() {
  return (
    <svg
      viewBox="0 0 208 58"
      /*
       * Visible, not clipped: the wordmark is live text in whatever font the
       * page loaded, and a fallback face with wider glyphs would otherwise be
       * cut off at the edge of the box rather than simply overhanging it.
       */
      overflow="visible"
      /*
       * The logo's own cream on the dark card, where it measures 12.0:1 and
       * looks exactly like the artwork. On the light card that same cream is
       * 1.5:1 against the cream ground — a watermark rather than a name — so
       * there the wordmark takes the theme's ink. The mark never changes.
       */
      className="nav-label h-auto w-[10.5rem] text-ink dark:text-[#e2caba]"
      role="img"
      aria-label="Aurum · Personal Finance"
    >
      <defs>
        <linearGradient id="aurum-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6cb6e" />
          <stop offset="0.34" stopColor="#e3aec4" />
          <stop offset="0.66" stopColor="#a877e2" />
          <stop offset="1" stopColor="#7c30e6" />
        </linearGradient>
      </defs>
      <circle cx="26" cy="29" r="24" fill="url(#aurum-mark)" />
      <text
        x="62"
        y="31"
        fill="currentColor"
        fontSize="30"
      >
        Aurum
      </text>
      <text
        x="62"
        y="50"
        fill="currentColor"
        fillOpacity="0.78"
        fontSize="14"
      >
        Personal Finance
      </text>
    </svg>
  );
}

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
        <Trash2 size={14} className="shrink-0" />
        <span className="nav-label">Delete demo data</span>
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

/**
 * Collapses the rail to its icons, and remembers the choice.
 *
 * The width itself is the stylesheet's, keyed off `data-nav` on <html> so it
 * is settled before the first paint; this only flips the attribute and writes
 * the preference down. Reading it back on load is the inline script in the
 * root layout.
 */
function CollapseToggle() {
  const mounted = useMounted();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(document.documentElement.dataset.nav === "collapsed");
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (next) document.documentElement.dataset.nav = "collapsed";
    else delete document.documentElement.dataset.nav;
    try {
      window.localStorage.setItem("aurum.nav", next ? "collapsed" : "expanded");
    } catch {
      /* Storage blocked: still collapsed, just not remembered. */
    }
  };

  return (
    <button
      onClick={toggle}
      title={collapsed ? "Expand menu" : "Collapse menu"}
      aria-label={collapsed ? "Expand menu" : "Collapse menu"}
      aria-pressed={mounted ? collapsed : undefined}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-ink-faint transition-colors hover:bg-elevated hover:text-ink-dim"
    >
      {collapsed ? (
        <PanelLeftOpen size={14} className="shrink-0" />
      ) : (
        <PanelLeftClose size={14} className="shrink-0" />
      )}
      <span className="nav-label">{collapsed ? "Expand menu" : "Collapse menu"}</span>
    </button>
  );
}

function SidebarContent({
  onNavigate,
  collapsible,
}: {
  onNavigate?: () => void;
  /* The drawer is never collapsed, so the toggle and the mark belong to the
     desktop rail alone. */
  collapsible?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Link
        href="/"
        onClick={onNavigate}
        className="block px-2 py-1"
      >
        {collapsible ? <AurumMark /> : null}
        <AurumLogo />
      </Link>

      <nav className="mt-6 flex-1 space-y-1">
        {VISIBLE_NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              title={label}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand/10 text-brand"
                  : "text-ink-dim hover:bg-elevated hover:text-ink",
              )}
            >
              <Icon size={16} className="shrink-0" />
              <span className="nav-label whitespace-nowrap">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-line pt-3">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="nav-label pl-2 text-[0.6875rem] uppercase tracking-wider text-ink-faint">
            Theme
          </span>
          <ThemeToggle />
        </div>
        <DeleteDemo />
        <button
          onClick={logout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-ink-faint transition-colors hover:bg-elevated hover:text-ink-dim"
        >
          <LogOut size={14} className="shrink-0" />
          <span className="nav-label">Sign out</span>
        </button>
        {collapsible ? <CollapseToggle /> : null}
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
      <aside className="nav-rail fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-surface p-3 lg:block">
        <SidebarContent collapsible />
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

      <div className="nav-content flex min-w-0 flex-1 flex-col">
        {/*
          * Scrolls away with the page. It was pinned to the top, which kept a
          * title and two buttons over every screen of content below it — a
          * band of the window spent restating where you already are.
          */}
        <header className="border-b border-line bg-background">
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
        <footer className="px-6 pb-6 pt-2 text-center text-[0.6875rem] text-ink-faint">
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
