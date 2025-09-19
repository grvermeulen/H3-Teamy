import type { Metadata } from "next";
import "./globals.css";
import Providers from "../components/Providers";

export const metadata: Metadata = {
  title: "De Rijn H3 Teamy MVP",
  description: "Waterpolo team calendar and RSVP",
  verification: {
    google: "ckmxM__EYIWSkCl_NQgW_pc2ausN1rpyDARkm80onEo",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0B1220" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon-180.png" />
      </head>
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
        <footer className="container" style={{ marginTop: 24 }}>
          <a href="/privacy" className="muted">Privacy policy</a>
        </footer>
        <script dangerouslySetInnerHTML={{ __html: `
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
        ` }} />
      </body>
    </html>
  );
}


