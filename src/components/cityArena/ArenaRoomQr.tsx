"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

/** A local QR contains only the room locator; phones still authenticate as team members. */
export function ArenaRoomQr({ code }: { code: string }): React.JSX.Element {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const path = `/arena/controller?code=${encodeURIComponent(code)}`;
  return (
    <div className="mx-3 mb-5 flex flex-wrap items-center justify-center gap-4 rounded border border-[var(--arena-line)] bg-[var(--arena-panel)] p-4">
      {origin ? (
        <QRCodeSVG
          value={origin + path}
          size={144}
          marginSize={4}
          title="Scan om je telefoon als controller te gebruiken"
        />
      ) : null}
      <div className="max-w-sm text-sm text-[var(--arena-text)]">
        <p className="arena-display text-lg">Speel samen op de tv</p>
        <p className="mt-1">
          Scan met je telefoon, log in en gebruik je telefoon als controller.
        </p>
        <a className="mt-2 block underline" href={path}>
          Controller openen · {code}
        </a>
        <a
          className="mt-2 block underline"
          href={`/arena/scherm?code=${encodeURIComponent(code)}`}
          target="_blank"
          rel="noreferrer"
        >
          Scherm openen
        </a>
      </div>
    </div>
  );
}
