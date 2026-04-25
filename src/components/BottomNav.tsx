"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "./SessionContext";

export default function BottomNav() {
  const pathname = usePathname() || "/";
  const { loading, loggedIn, isTrainer, isAdmin } = useSession();

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  if (loading) return null;

  return (
    <nav className="bottomBar" aria-label="Hoofdnavigatie">
      <div className="container" style={{ padding: 0 }}>
        <div className="bottomNavLinks">
          <Link href="/" className={isActive("/") ? "navActive" : undefined}>
            RSVP
          </Link>
          <Link
            href="/attendance"
            className={isActive("/attendance") ? "navActive" : undefined}
          >
            Opkomst
          </Link>
          {loggedIn && isTrainer ? (
            <Link
              href="/trainer/attendance"
              className={
                isActive("/trainer/attendance") ? "navActive" : undefined
              }
            >
              Trainer
            </Link>
          ) : null}
          {loggedIn && isAdmin ? (
            <Link
              href="/admin"
              className={isActive("/admin") ? "navActive" : undefined}
            >
              Admin
            </Link>
          ) : null}
          <Link
            href="/profile"
            className={isActive("/profile") ? "navActive" : undefined}
          >
            Profiel
          </Link>
          {loggedIn ? (
            <form action="/api/auth/signout" method="post">
              <input type="hidden" name="callbackUrl" value="/" />
              <button type="submit">Uitloggen</button>
            </form>
          ) : (
            <Link href={{ pathname: "/login", query: { callbackUrl: "/" } }}>
              Inloggen
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
