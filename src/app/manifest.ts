import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const isChristmasTheme =
    process.env.christmas_event === "TRUE" ||
    process.env.NEXT_PUBLIC_christmas_event === "TRUE";
  return {
    name: "De Rijn H3 — Waterpolo",
    short_name: "De Rijn H3",
    description: "Matches from Sportlink • RSVP on device",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: isChristmasTheme ? "#1a0f1a" : "#0B1220",
    theme_color: isChristmasTheme ? "#1a0f1a" : "#0B1220",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
