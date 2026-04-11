"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, type ReactElement } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Root-level foutgrens voor onverwachte runtimefouten buiten de normale layout.
 * Rapporteert naar Sentry en biedt een herstelactie.
 */
export default function GlobalError({
  error,
  reset,
}: GlobalErrorProps): ReactElement {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="nl">
      <body>
        <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <h2>Er is iets misgegaan!</h2>
          <button
            type="button"
            onClick={reset}
            className="cursor-pointer rounded border-0 bg-[#111926] px-4 py-2 text-white"
          >
            Opnieuw proberen
          </button>
        </div>
      </body>
    </html>
  );
}
