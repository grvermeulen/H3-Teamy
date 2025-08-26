"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function SessionStatus() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;
        setLoggedIn(!!data?.user);
      } catch {
        if (!alive) return;
        setLoggedIn(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loggedIn === null) return null;

  return (
    <div className="row" style={{ alignItems: "center", gap: 12 }}>
      {loggedIn ? (
        <>
          <span className="muted">Logged in</span>
          <form action="/api/auth/signout" method="post">
            <input type="hidden" name="callbackUrl" value="/" />
            <button type="submit">Log out</button>
          </form>
        </>
      ) : (
        <Link href={{ pathname: "/login", query: { callbackUrl: "/" } }}>Login</Link>
      )}
    </div>
  );
}



