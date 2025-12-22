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

      // Create snowflakes
      const createSnowflake = () => {
        const snowflake = document.createElement("div");
        snowflake.className = "snowflake";
        snowflake.style.left = Math.random() * 100 + "%";
        const duration = Math.random() * 4 + 3; // 3-7 seconds
        snowflake.style.setProperty("--snow-duration", duration + "s");
        snowflake.style.animationDuration = duration + "s";
        snowflake.style.animationDelay = Math.random() * 2 + "s";
        snowflake.style.opacity = Math.random() * 0.6 + 0.4;
        const size = Math.random() * 15 + 12; // 12-27px
        snowflake.style.fontSize = size + "px";
        // Use different snowflake characters for variety
        const snowflakes = ["❄", "❅", "❆", "✻", "✼", "✽"];
        snowflake.textContent =
          snowflakes[Math.floor(Math.random() * snowflakes.length)];
        document.body.appendChild(snowflake);

        // Remove snowflake after animation
        setTimeout(
          () => {
            if (snowflake.parentNode) {
              snowflake.remove();
            }
          },
          (duration + 2) * 1000,
        );
      };

      // Create initial snowflakes
      for (let i = 0; i < 30; i++) {
        setTimeout(() => createSnowflake(), i * 150);
      }

      // Keep creating snowflakes continuously
      const snowInterval = setInterval(() => {
        createSnowflake();
      }, 200);

      return () => {
        clearInterval(snowInterval);
        // Remove all snowflakes
        document.querySelectorAll(".snowflake").forEach((el) => el.remove());
        document.documentElement.classList.remove("christmas-theme");
      };
    } else {
      document.documentElement.classList.remove("christmas-theme");
    }
  }, []);

  return null;
}
