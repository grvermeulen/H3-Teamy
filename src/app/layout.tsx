import type { Metadata } from "next";
import "./globals.css";
import Providers from "../components/Providers";
import BottomNav from "../components/BottomNav";
import ChristmasTheme from "../components/ChristmasTheme";
import SessionStatus from "../components/SessionStatus";
import FeedbackFab from "../components/FeedbackFab";
import WhatsNewTour from "../components/WhatsNewTour";
import { ToastRegion } from "../components/ui";

export const metadata: Metadata = {
  title: "De Rijn H3 Teamy MVP",
  description: "Waterpolo team calendar and RSVP",
  verification: {
    google: "ckmxM__EYIWSkCl_NQgW_pc2ausN1rpyDARkm80onEo",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Check both server-side and client-side environment variables
  const isChristmasTheme =
    process.env.christmas_event === "TRUE" ||
    process.env.NEXT_PUBLIC_christmas_event === "TRUE";
  return (
    <html
      lang="nl"
      className={isChristmasTheme ? "christmas-theme" : undefined}
    >
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta
          name="theme-color"
          content={isChristmasTheme ? "#1a0f1a" : "#0B1220"}
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/icons/apple-touch-icon-180.png"
        />
      </head>
      <body>
        <ChristmasTheme />
        <Providers>
          <header
            className="container"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              paddingTop: 20,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={process.env.NEXT_PUBLIC_LOGO_URL || "/logo.svg"}
              alt="H3-logo"
              width={44}
              height={44}
              style={{
                borderRadius: 8,
                background: "#111926",
                objectFit: "cover",
              }}
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>
                De Rijn H3 — Waterpolo
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Wedstrijden uit Sportlink • RSVP op je telefoon
              </div>
            </div>
          </header>
          <div className="container topNavSpacer">
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <SessionStatus />
            </div>
          </div>
          {children}
          <FeedbackFab />
          <WhatsNewTour />
          <BottomNav />
          <ToastRegion />
          <footer className="container" style={{ marginTop: 24 }}>
            <a href="/privacy" className="muted">
              Privacybeleid
            </a>
          </footer>
        </Providers>
        <script
          dangerouslySetInnerHTML={{
            __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function () {
              navigator.serviceWorker.register('/sw.js').then((registration) => {
                if (registration.waiting) {
                  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                  return;
                }
                registration.addEventListener('updatefound', () => {
                  const newWorker = registration.installing;
                  if (!newWorker) return;
                  newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                      newWorker.postMessage({ type: 'SKIP_WAITING' });
                    }
                  });
                });
                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                  if (refreshing) return;
                  refreshing = true;
                  window.location.reload();
                });
              }).catch(()=>{});
            });
          }
        `,
          }}
        />
      </body>
    </html>
  );
}
