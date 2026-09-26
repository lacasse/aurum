"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { Button, Card, Field, Input } from "@/components/ui";
import { usernameProblem } from "@/lib/usernames";
import { passwordProblem } from "@/lib/invites";

async function send(url: string, body: object): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? "That could not be saved." };
  } catch {
    return { ok: false, error: "That could not be saved." };
  }
}

/**
 * How this person signs in: their username and their password. Both changes
 * ask for the current password, because a browser left signed in is not the
 * same as the person who owns the account.
 */
export function AccountSettings() {
  const [username, setUsername] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [namePassword, setNamePassword] = useState("");
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [passMsg, setPassMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<"name" | "password" | null>(null);
  const [editing, setEditing] = useState<"name" | "password" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { username?: string } | null) => {
        if (!cancelled && me?.username) setUsername(me.username);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const rename = async () => {
    const problem = usernameProblem(nameDraft.trim().toLowerCase());
    if (problem) return setNameMsg({ ok: false, text: problem });
    setBusy("name");
    const r = await send("/api/me/username", { username: nameDraft, password: namePassword });
    setBusy(null);
    if (!r.ok) return setNameMsg({ ok: false, text: r.error });
    const saved = (r.data as { username: string }).username;
    setUsername(saved);
    setNameDraft("");
    setNamePassword("");
    setNameMsg({ ok: true, text: `Saved. You now sign in as ${saved}.` });
    setEditing(null);
  };

  const changePassword = async () => {
    const problem = passwordProblem(next);
    if (problem) return setPassMsg({ ok: false, text: problem });
    if (next !== repeat) return setPassMsg({ ok: false, text: "The two new passwords do not match." });
    setBusy("password");
    const r = await send("/api/me/password", { password: current, newPassword: next });
    setBusy(null);
    if (!r.ok) return setPassMsg({ ok: false, text: r.error });
    setCurrent("");
    setNext("");
    setRepeat("");
    setPassMsg({ ok: true, text: "Password changed. Other devices have been signed out." });
    setEditing(null);
  };

  const note = (m: { ok: boolean; text: string } | null) =>
    m ? <p className={`text-xs ${m.ok ? "text-positive" : "text-negative"}`}>{m.text}</p> : null;

  return (
    <Card className="px-5 py-4">
      <div className="mb-1 flex items-center gap-2">
        <UserRound size={15} className="text-ink-faint" />
        <h2 className="text-sm font-medium text-ink">Your account</h2>
      </div>
      <div className="divide-y divide-line">
        <Row
          label="Username"
          value={username || "…"}
          open={editing === "name"}
          onToggle={() => {
            setEditing(editing === "name" ? null : "name");
            setNameMsg(null);
          }}
          done={nameMsg?.ok ? nameMsg.text : null}
        >
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <Field label="New username">
              <Input
                autoFocus
                autoComplete="username"
                spellCheck={false}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
              />
            </Field>
            <Field label="Current password">
              <Input
                type="password"
                autoComplete="current-password"
                value={namePassword}
                onChange={(e) => setNamePassword(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy !== null || !nameDraft.trim() || !namePassword}>
              {busy === "name" ? "Saving…" : "Save"}
            </Button>
          </form>
          {nameMsg && !nameMsg.ok ? note(nameMsg) : null}
        </Row>
        <Row
          label="Password"
          value="••••••••••••"
          open={editing === "password"}
          onToggle={() => {
            setEditing(editing === "password" ? null : "password");
            setPassMsg(null);
          }}
          done={passMsg?.ok ? passMsg.text : null}
        >
          <form
            className="grid gap-3 sm:grid-cols-3 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void changePassword();
            }}
          >
            <Field label="Current">
              <Input
                autoFocus
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field label="New (12+ characters)">
              <Input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
            <Field label="New, again">
              <Input
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </Field>
          </form>
          <div className="flex items-center gap-3">
            <p className="flex-1 text-xs text-ink-faint">Other devices will be signed out.</p>
            <Button
              disabled={busy !== null || !current || !next || !repeat}
              onClick={() => void changePassword()}
            >
              {busy === "password" ? "Saving…" : "Save"}
            </Button>
          </div>
          {passMsg && !passMsg.ok ? note(passMsg) : null}
        </Row>
      </div>
    </Card>
  );
}

/** One setting: its current value, and a form that opens in place. */
function Row({
  label,
  value,
  open,
  onToggle,
  done,
  children,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  done: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-xs text-ink-faint">{label}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{value}</span>
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {open ? "Cancel" : "Change"}
        </Button>
      </div>
      {done && !open ? <p className="mt-1 sm:pl-27 text-xs text-positive">{done}</p> : null}
      {open ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
}
