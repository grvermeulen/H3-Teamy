"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function BottomNav() {
  const pathname = usePathname() || "/";
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [isTrainer, setIsTrainer] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;
        const ok = !!data?.user;
        setLoggedIn(ok);
        if (ok) {
          const [t, a] = await Promise.all([
            fetch("/api/trainer/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ isTrainer: false })),
            fetch("/api/admin/status", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ isAdmin: false })),
          ]);
          if (!alive) return;
          setIsTrainer(Boolean(t?.isTrainer));
          setIsAdmin(Boolean(a?.isAdmin));
        }
      } catch {
        if (!alive) return;
        setLoggedIn(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loggedIn === null) return null;

  return (
    <nav className="bottomBar" aria-label="Bottom navigation">
      <div className="container" style={{ padding: 0 }}>
        <div className="bottomNavLinks">
          <Link href="/" className={isActive("/") ? "navActive" : undefined}>RSVP</Link>
          <Link href="/attendance" className={isActive("/attendance") ? "navActive" : undefined}>Attendance</Link>
          {loggedIn && isTrainer ? (
            <Link href="/trainer/attendance" className={isActive("/trainer/attendance") ? "navActive" : undefined}>Trainer</Link>
          ) : null}
          {loggedIn && isAdmin ? (
            <Link href="/admin" className={isActive("/admin") ? "navActive" : undefined}>Admin</Link>
          ) : null}
          <Link href="/profile" className={isActive("/profile") ? "navActive" : undefined}>Profile</Link>
          {loggedIn ? (
            <form action="/api/auth/signout" method="post">
              <input type="hidden" name="callbackUrl" value="/" />
              <button type="submit">Log out</button>
            </form>
          ) : (
            <Link href={{ pathname: "/login", query: { callbackUrl: "/" } }}>Login</Link>
          )}
        </div>
      </div>
    </nav>
  );
}


