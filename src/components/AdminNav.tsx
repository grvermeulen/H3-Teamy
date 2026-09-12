"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin", label: "Gebruikers" },
  { href: "/admin/feedback", label: "Feedback" },
] as const;

/** Compact tab navigation shared by all admin screens. */
export default function AdminNav() {
  const pathname = usePathname() || "/admin";

  return (
    <nav className="admin-tabs" aria-label="Admin-onderdelen">
      {items.map((item) => {
        const active =
          item.href === "/admin"
            ? pathname === item.href
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
