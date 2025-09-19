"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function SessionStatus() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [isTrainer, setIsTrainer] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;
        setLoggedIn(!!data?.user);
        if (data?.user) {
          const t = await fetch("/api/trainer/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ isTrainer: false }));
          if (!alive) return;
          setIsTrainer(Boolean(t?.isTrainer));
          const a = await fetch("/api/admin/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ isAdmin: false }));
          if (!alive) return;
          setIsAdmin(Boolean(a?.isAdmin));
        }
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
    <div className="navBar">
      <div className="navLinks">
        {loggedIn ? (
          <>
            <Link href={{ pathname: "/attendance" }}>Attendance</Link>
            {isTrainer ? <Link href={{ pathname: "/trainer/attendance" }}>Trainer</Link> : null}
            {isAdmin ? <Link href={{ pathname: "/admin" }}>Admin</Link> : null}
            <Link href={{ pathname: "/profile" }}>Profile</Link>
            <form action="/api/auth/signout" method="post">
              <input type="hidden" name="callbackUrl" value="/" />
              <button type="submit">Log out</button>
            </form>
          </>
        ) : (
          <Link href={{ pathname: "/login", query: { callbackUrl: "/" } }}>Login</Link>
        )}
      </div>
      <button className="burger" aria-label="Menu" onClick={() => setOpen((v) => !v)}>☰</button>
      <div className={open ? "drawer open" : "drawer"} onClick={() => setOpen(false)}>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
          {loggedIn ? (
            <>
              <Link href={{ pathname: "/attendance" }} onClick={() => setOpen(false)}>Attendance</Link>
              {isTrainer ? <Link href={{ pathname: "/trainer/attendance" }} onClick={() => setOpen(false)}>Trainer</Link> : null}
              {isAdmin ? <Link href={{ pathname: "/admin" }} onClick={() => setOpen(false)}>Admin</Link> : null}
              <Link href={{ pathname: "/profile" }} onClick={() => setOpen(false)}>Profile</Link>
              <form action="/api/auth/signout" method="post">
                <input type="hidden" name="callbackUrl" value="/" />
                <button type="submit">Log out</button>
              </form>
            </>
          ) : (
            <Link href={{ pathname: "/login", query: { callbackUrl: "/" } }} onClick={() => setOpen(false)}>Login</Link>
          )}
        </div>
      </div>
    </div>
  );
}



