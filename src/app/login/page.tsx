"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Lock, Sparkles } from "lucide-react";
import { Button, Input, Field } from "@/components/ui";
import { useFinance } from "@/lib/store";
import { enterDemo, leaveDemo } from "@/lib/demo";

function LoginForm() {
  const router = useRouter();
  const loadFromServer = useFinance((s) => s.loadFromServer);
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next") || "/";

  // Same-origin check: only allow local path navigation (no open redirect).
  const next = (() => {
    if (typeof window === "undefined") return "/";
    if (!rawNext.startsWith("/") || rawNext.startsWith("//")) return "/";
    const target = new URL(rawNext, window.location.origin);
    if (target.origin !== window.location.origin) return "/";
    return target.pathname + target.search + target.hash;
  })();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Invalid credentials");
        return;
      }
      /*
       * Read the record before leaving this page.
       *
       * The store is loaded once, when the app mounts — which on this page
       * happened before there was a session, so the request came back 401 and
       * left an empty store behind it. Signing in is a client-side navigation,
       * so nothing mounts again and nothing asks a second time: every page
       * then draws its charts from that empty store, which is zeros presented
       * as the answer. The only way out was the "Sign in again" link on the
       * failure banner, and only because a plain link is a full page load.
       *
       * So the new session is used here, before the navigation, and the
       * failure banner clears with it. If this request fails the banner says
       * so, which is the correct outcome rather than a silent one.
       */
      // A real session ends the demo, or the store would load the demo again.
      leaveDemo();
      await loadFromServer();
      router.push(next);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /*
   * The same order as signing in: load the store as the demo first, then
   * navigate. The store loaded once already, when this page mounted without a
   * demo, and a client navigation does not load it again. The cookie goes with
   * the navigation's own requests, which is what lets the route guard through.
   */
  const tryDemo = async () => {
    enterDemo();
    await loadFromServer();
    router.push("/");
    router.refresh();
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          {/* The same mark as the sidebar and the tab icon. */}
          <span
            className="h-12 w-12 rounded-full shadow-sm"
            style={{
              background:
                "linear-gradient(135deg, #f6cb6e 0%, #e3aec4 34%, #a877e2 66%, #7c30e6 100%)",
            }}
          />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">
            Aurum
          </h1>
          <p className="mt-1 text-sm text-ink-faint">Sign in to continue</p>
        </div>

        <form
          onSubmit={submit}
          className="mt-8 space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm"
        >
          <Field label="Username">
            <Input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              required
              autoFocus
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
            />
          </Field>

          {error ? (
            <p className="flex items-center gap-1.5 rounded-lg bg-negative/10 px-3 py-2 text-xs text-negative">
              <Lock size={12} />
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="mt-4 rounded-2xl border border-dashed border-line p-4 text-center">
          <Button variant="secondary" className="w-full" onClick={tryDemo}>
            <Sparkles size={15} /> Explore with demo data
          </Button>
          <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-faint">
            The whole app, with invented figures. Anything you change is saved in
            this browser only, and never sent anywhere.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
