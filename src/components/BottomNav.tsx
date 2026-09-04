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

  const icons = {
    calendar: <span aria-hidden="true">◫</span>,
    attendance: <span aria-hidden="true">✓</span>,
    trainer: <span aria-hidden="true">＋</span>,
    admin: <span aria-hidden="true">◇</span>,
    profile: <span aria-hidden="true">○</span>,
  };

  return (
    <nav className="bottomBar" aria-label="Hoofdnavigatie">
      <div className="container" style={{ padding: 0 }}>
        <div className="bottomNavLinks">
          <Link
            href="/"
            className={isActive("/") ? "navActive" : undefined}
            aria-current={isActive("/") ? "page" : undefined}
          >
            {icons.calendar}
            <small>RSVP</small>
          </Link>
          <Link
            href="/attendance"
            className={isActive("/attendance") ? "navActive" : undefined}
            aria-current={isActive("/attendance") ? "page" : undefined}
          >
            {icons.attendance}
            <small>Opkomst</small>
          </Link>
          {loggedIn && isTrainer ? (
            <Link
              href="/trainer/attendance"
              className={
                isActive("/trainer/attendance") ? "navActive" : undefined
              }
              aria-current={
                isActive("/trainer/attendance") ? "page" : undefined
              }
            >
              {icons.trainer}
              <small>Trainer</small>
            </Link>
          ) : null}
          {loggedIn && isAdmin ? (
            <Link
              href="/admin"
              className={isActive("/admin") ? "navActive" : undefined}
              aria-current={isActive("/admin") ? "page" : undefined}
            >
              {icons.admin}
              <small>Admin</small>
            </Link>
          ) : null}
          <Link
            href={loggedIn ? "/profile" : "/login"}
            className={
              isActive(loggedIn ? "/profile" : "/login")
                ? "navActive"
                : undefined
            }
            aria-current={
              isActive(loggedIn ? "/profile" : "/login") ? "page" : undefined
            }
          >
            {icons.profile}
            <small>{loggedIn ? "Profiel" : "Inloggen"}</small>
          </Link>
        </div>
      </div>
    </nav>
  );
}
