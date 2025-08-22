import type { Metadata } from "next";
import "./globals.css";
import Providers from "../components/Providers";

export const metadata: Metadata = {
  title: "De Rijn H3 Teamy MVP",
  description: "Waterpolo team calendar and RSVP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="container" style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={process.env.NEXT_PUBLIC_LOGO_URL || "/logo.svg"}
            alt="H3 Logo"
            width={44}
            height={44}
            style={{ borderRadius: 8, background: "#111926", objectFit: "cover" }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>De Rijn H3 — Waterpolo</div>
            <div className="muted" style={{ fontSize: 13 }}>Matches from Sportlink • RSVP on device</div>
          </div>
        </header>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}


