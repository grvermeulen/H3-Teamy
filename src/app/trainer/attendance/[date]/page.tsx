"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AppBar, Button, showToast } from "../../../../components/ui";

type User = { id: string; name: string };

/**
 * Resolves a single date segment value from route params.
 * @param dateParam - Route date segment value from Next.js params.
 * @returns The first date segment or an empty string if unavailable.
 */
export function resolveDateParam(
  dateParam: string | string[] | undefined,
): string {
  if (Array.isArray(dateParam)) return dateParam[0] || "";
  return dateParam || "";
}

export default function SessionChecklist() {
  const params = useParams<{ date?: string | string[] }>();
  const date = resolveDateParam(params?.date);
  const [roster, setRoster] = useState<User[]>([]);
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isTrainer, setIsTrainer] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const st = await fetch("/api/trainer/status", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ isTrainer: false }));
      if (!mounted) return;
      setIsTrainer(Boolean(st?.isTrainer));
      // Roster: list all users by name
      const users = await fetch("/api/users", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({ users: [] }));
      const list: User[] = Array.isArray(users?.users) ? users.users : [];
      if (!mounted) return;
      setRoster(list);
      if (!date) {
        setPresent(new Set());
        setDirty(false);
        return;
      }
      const att = await fetch(
        `/api/training/attendance?date=${encodeURIComponent(date)}`,
        { cache: "no-store" },
      )
        .then((r) => r.json())
        .catch(() => ({ presentUserIds: [] }));
      if (!mounted) return;
      setPresent(new Set((att?.presentUserIds || []) as string[]));
      setDirty(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [date]);

  function toggle(uid: string) {
    setPresent((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
    setDirty(true);
  }

  async function onSave() {
    setSaveError(null);
    if (!date) {
      setSaveError("Opslaan mislukt: ongeldige datum");
      return;
    }
    setSaving(true);
    try {
      const ids = Array.from(present);
      const res = await fetch("/api/training/attendance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, presentUserIds: ids }),
      });
      if (!res.ok) {
        const txt = await res.text();
        setSaveError(`Opslaan mislukt: ${txt}`);
        return;
      }
      setDirty(false);
      showToast("Opkomst opgeslagen", "success");
    } catch {
      setSaveError(
        "Opslaan mislukt. Controleer je verbinding en probeer opnieuw.",
      );
    } finally {
      setSaving(false);
    }
  }

  const sorted = useMemo(() => {
    return roster.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [roster]);

  if (isTrainer === false) {
    return (
      <div className="container">
        <AppBar
          title={date || "Trainingsopkomst"}
          fallbackHref="/trainer/attendance"
        />
        <div className="muted">Je hebt geen toegang.</div>
      </div>
    );
  }
  if (isTrainer === null) {
    return (
      <div className="container">
        <AppBar title="Trainingsopkomst" fallbackHref="/trainer/attendance" />
        <div
          className="card skeleton"
          style={{ height: 72 }}
          aria-label="Opkomst laden"
        />
      </div>
    );
  }

  return (
    <main>
      <div className="container">
        <AppBar
          title={`Opkomst – ${date}`}
          fallbackHref="/trainer/attendance"
        />

        <div className="card" style={{ position: "sticky", top: 0, zIndex: 1 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div className="muted">Aanwezig: {present.size}</div>
            <div className="row" style={{ gap: 8 }}>
              <Button
                onClick={() => void onSave()}
                disabled={!dirty}
                loading={saving}
                loadingLabel="Opslaan…"
              >
                Opslaan
              </Button>
            </div>
          </div>
          {saveError ? (
            <div
              role="alert"
              className="muted"
              style={{ marginTop: 8, color: "var(--negative)" }}
            >
              {saveError}
            </div>
          ) : null}
        </div>
        <div className="list">
          {sorted.map((u) => (
            <button
              key={u.id}
              className="card"
              onClick={() => toggle(u.id)}
              style={{
                textAlign: "left",
                borderColor: present.has(u.id) ? "var(--positive)" : undefined,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>{u.name}</div>
                <div
                  className="badge"
                  style={{
                    background: present.has(u.id)
                      ? "color-mix(in oklab, var(--positive) 22%, transparent)"
                      : undefined,
                    color: present.has(u.id) ? "var(--positive)" : undefined,
                  }}
                >
                  {present.has(u.id) ? "Aanwezig" : "Tik om te markeren"}
                </div>
              </div>
            </button>
          ))}
          {sorted.length === 0 ? (
            <div className="muted">Geen leden gevonden.</div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
