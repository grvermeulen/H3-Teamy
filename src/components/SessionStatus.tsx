"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

export default function SessionStatus() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [isTrainer, setIsTrainer] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  function isActive(target: string): boolean {
    if (target === "/") return pathname === "/";
    return pathname.startsWith(target);
  }

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
            <Link href={{ pathname: "/" }} className={isActive("/") ? "navActive" : undefined}>RSVP</Link>
            <Link href={{ pathname: "/attendance" }} className={isActive("/attendance") ? "navActive" : undefined}>Attendance</Link>
            {isTrainer ? <Link href={{ pathname: "/trainer/attendance" }} className={isActive("/trainer/attendance") ? "navActive" : undefined}>Trainer</Link> : null}
            {isAdmin ? <Link href={{ pathname: "/admin" }} className={isActive("/admin") ? "navActive" : undefined}>Admin</Link> : null}
            <Link href={{ pathname: "/profile" }} className={isActive("/profile") ? "navActive" : undefined}>Profile</Link>
            <form action="/api/auth/signout" method="post">
              <input type="hidden" name="callbackUrl" value="/" />
              <button type="submit">Log out</button>
            </form>
          </>
        ) : (
          <Link href={{ pathname: "/login", query: { callbackUrl: "/" } }}>Login</Link>
        )}
      </div>
      <div className="bottomBar">
        <div className="bottomNavLinks">
          {loggedIn ? (
            <>
              <Link href={{ pathname: "/" }} className={isActive("/") ? "navActive" : undefined}>RSVP</Link>
              <Link href={{ pathname: "/attendance" }} className={isActive("/attendance") ? "navActive" : undefined}>Attendance</Link>
              {isTrainer ? <Link href={{ pathname: "/trainer/attendance" }} className={isActive("/trainer/attendance") ? "navActive" : undefined}>Trainer</Link> : null}
              {isAdmin ? <Link href={{ pathname: "/admin" }} className={isActive("/admin") ? "navActive" : undefined}>Admin</Link> : null}
              <Link href={{ pathname: "/profile" }} className={isActive("/profile") ? "navActive" : undefined}>Profile</Link>
              <form action="/api/auth/signout" method="post">
                <input type="hidden" name="callbackUrl" value="/" />
                <button type="submit">Log out</button>
              </form>
            </>
          ) : (
            <Link href={{ pathname: "/login", query: { callbackUrl: "/" } }}>Login</Link>
          )}
        </div>
      </div>
    </div>
  );
}



