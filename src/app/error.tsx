"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "50vh",
        gap: "1rem",
        textAlign: "center",
      }}
    >
      <h2>Something went wrong!</h2>
      <p style={{ color: "#888", maxWidth: "400px" }}>
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        style={{
          padding: "8px 16px",
          background: "#111926",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
