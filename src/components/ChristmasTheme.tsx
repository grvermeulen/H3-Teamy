"use client";

import { useEffect } from "react";

export default function ChristmasTheme() {
  useEffect(() => {
    // Check for Christmas theme environment variable (client-side)
    // NEXT_PUBLIC_ prefix makes it available on client-side
    const isChristmasTheme = process.env.NEXT_PUBLIC_christmas_event === "TRUE";

    if (isChristmasTheme) {
      document.documentElement.classList.add("christmas-theme");
      // Also update theme-color meta tag
      const metaTheme = document.querySelector('meta[name="theme-color"]');
      if (metaTheme) {
        metaTheme.setAttribute("content", "#1a0f1a");
      }
    } else {
      document.documentElement.classList.remove("christmas-theme");
    }
  }, []);

  return null;
}
