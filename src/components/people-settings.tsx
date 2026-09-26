"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Trash2, UserPlus, Users } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, Input, Modal } from "@/components/ui";

interface Person {
  id: string;
  username: string;
  role: "admin" | "member";
  createdAt: string;
  you: boolean;
  /** False for yourself and for the installation's owner; the server agrees. */
  deletable: boolean;
}

interface Invite {
  id: string;
  status: "pending" | "accepted" | "expired";
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedBy: string | null;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/**
 * Who has an account here, and the invitations out to others. Shown only to
 * administrators; the server refuses the same request from anyone else.
 *
 * A new invitation's link is shown once, in this card, and never again — only
 * a hash of its token is kept — so the card says plainly to copy it now.
 */
export function PeopleSettings() {
  const [people, setPeople] = useState<Person[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [fresh, setFresh] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/invites", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { people: Person[]; invites: Invite[] };
    setPeople(data.people);
    setInvites(data.invites);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/invites", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { people: Person[]; invites: Invite[] } | null) => {
        if (cancelled || !data) return;
        setPeople(data.people);
        setInvites(data.invites);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const res = await fetch("/api/invites", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { path: string; expiresAt: string };
      setFresh({ url: `${window.location.origin}${data.path}`, expiresAt: data.expiresAt });
      await load();
    } catch {
      setError("The invitation could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const [removing, setRemoving] = useState<Person | null>(null);

  const pending = invites.filter((i) => i.status === "pending");
  const past = invites.filter((i) => i.status !== "pending").slice(0, 5);

  return (
    <Card>
      <CardHeader
        title="People"
        subtitle="Everyone with an account here keeps a separate record; nobody can see anyone else's."
        action={
          <Button size="sm" onClick={() => void create()} disabled={busy}>
            <UserPlus size={14} /> {busy ? "Creating…" : "Invite someone"}
          </Button>
        }
      />
      <div className="space-y-5 px-5 pb-5">
        {fresh ? (
          <div className="rounded-xl border border-brand/40 bg-brand/5 p-4">
            <p className="text-sm font-medium text-ink">Copy this link now</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-dim">
              It is shown once and cannot be retrieved later. Send it to the person you
              are inviting; it makes one account and stops working on{" "}
              {day(fresh.expiresAt)}.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-elevated px-3 py-2 text-xs text-ink">
                {fresh.url}
              </code>
              <Button size="sm" variant="secondary" onClick={() => void copy()}>
                <Copy size={13} /> {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : null}
        {error ? <p className="text-xs text-negative">{error}</p> : null}

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-dim">
            <Users size={13} /> Accounts
          </p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {people.map((p) => (
              <li key={p.username} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="font-medium text-ink">{p.username}</span>
                {p.role === "admin" ? <Badge>Admin</Badge> : null}
                {p.you ? <span className="text-xs text-ink-faint">you</span> : null}
                <span className="ml-auto text-xs text-ink-faint">since {day(p.createdAt)}</span>
                {p.deletable ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    title={`Delete ${p.username}`}
                    onClick={() => setRemoving(p)}
                  >
                    <Trash2 size={13} /> Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {pending.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium text-ink-dim">Waiting to be accepted</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {pending.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-xs text-ink-dim">
                  <span>Created {day(i.createdAt)}</span>
                  <span className="text-ink-faint">· expires {day(i.expiresAt)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => void revoke(i.id)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {past.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium text-ink-dim">Recent invitations</p>
            <ul className="space-y-1 text-xs text-ink-faint">
              {past.map((i) => (
                <li key={i.id}>
                  {day(i.createdAt)} ·{" "}
                  {i.status === "accepted"
                    ? `accepted by ${i.acceptedBy ?? "a removed account"}`
                    : "expired or revoked, unused"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <DeletePerson
        person={removing}
        onClose={() => setRemoving(null)}
        onDeleted={() => {
          setRemoving(null);
          void load();
        }}
      />
    </Card>
  );
}

/**
 * Deleting someone else's account takes their whole record with it, so it asks
 * for their username typed out and the administrator's own password.
 */
function DeletePerson({
  person,
  onClose,
  onDeleted,
}: {
  person: Person | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    if (busy) return;
    setConfirm("");
    setPassword("");
    setError("");
    onClose();
  };

  const matches = person !== null && confirm.trim().toLowerCase() === person.username;

  const remove = async () => {
    if (!person) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(person.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Nothing was deleted. Please try again.");
        return;
      }
      setConfirm("");
      setPassword("");
      onDeleted();
    } catch {
      setError("Nothing was deleted. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={person !== null} onClose={close} title={`Delete ${person?.username ?? ""}`}>
      <form
        className="space-y-4 text-sm text-ink-dim"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && password) void remove();
        }}
      >
        <p>
          This deletes the account <span className="font-medium text-ink">{person?.username}</span>{" "}
          and everything in it — accounts, transactions, holdings, settings and keys. They
          are signed out at once and cannot sign in again. There is no undo.
        </p>
        <Field label={`Type ${person?.username ?? "the username"} to confirm`}>
          <Input
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Field label="Your password">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error ? <p className="text-xs text-negative">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy || !matches || !password}>
            {busy ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
