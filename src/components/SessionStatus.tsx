"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession } from "./SessionContext";

export default function SessionStatus() {
  const pathname = usePathname() || "/";
  const { loading, loggedIn, isTrainer, isAdmin } = useSession();

  function isActive(target: string): boolean {
    if (target === "/") return pathname === "/";
    return pathname === target || pathname.startsWith(target + "/");
  }

  if (loading) return null;

  return (
    <div className="navBar">
      <div className="navLinks">
        {loggedIn ? (
          <>
            <Link
              href={{ pathname: "/" }}
              className={isActive("/") ? "navActive" : undefined}
            >
              RSVP
            </Link>
            <Link
              href={{ pathname: "/attendance" }}
              className={isActive("/attendance") ? "navActive" : undefined}
            >
              Opkomst
            </Link>
            {isTrainer ? (
              <Link
                href={{ pathname: "/trainer/attendance" }}
                className={
                  isActive("/trainer/attendance") ? "navActive" : undefined
                }
              >
                Trainer
              </Link>
            ) : null}
            {isAdmin ? (
              <Link
                href={{ pathname: "/admin" }}
                className={isActive("/admin") ? "navActive" : undefined}
              >
                Admin
              </Link>
            ) : null}
            <Link
              href={{ pathname: "/profile" }}
              className={isActive("/profile") ? "navActive" : undefined}
            >
              Profiel
            </Link>
            <form action="/api/auth/signout" method="post">
              <input type="hidden" name="callbackUrl" value="/" />
              <button type="submit">Uitloggen</button>
            </form>
          </>
        ) : (
          <Link href={{ pathname: "/login", query: { callbackUrl: "/" } }}>
            Inloggen
          </Link>
        )}
      </div>
    </div>
  );
}
