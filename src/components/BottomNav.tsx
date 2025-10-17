"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function BottomNav() {
  const pathname = usePathname() || "/";

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <nav className="bottomBar" aria-label="Bottom navigation">
      <div className="container" style={{ padding: 0 }}>
        <div className="bottomNavLinks">
          <Link href="/" className={isActive("/") ? "navActive" : undefined}>RSVP</Link>
          <Link href="/attendance" className={isActive("/attendance") ? "navActive" : undefined}>Attendance</Link>
          <Link href="/trainer/attendance" className={isActive("/trainer") ? "navActive" : undefined}>Trainer</Link>
          <Link href="/admin" className={isActive("/admin") ? "navActive" : undefined}>Admin</Link>
          <Link href="/profile" className={isActive("/profile") ? "navActive" : undefined}>Profile</Link>
        </div>
      </div>
    </nav>
  );
}


