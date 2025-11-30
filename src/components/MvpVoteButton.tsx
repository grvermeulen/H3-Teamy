"use client";

import { useEffect, useState } from "react";
import NextDynamic from "next/dynamic";

const MvpVotingPanel = NextDynamic(() => import("./MvpVotingPanel"), {
  ssr: false,
});

type Props = { eventId: string };

export default function MvpVoteButton({ eventId }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousTouchAction = body.style.touchAction;
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    return () => {
      body.style.overflow = previousOverflow;
      body.style.touchAction = previousTouchAction;
    };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Stem op MVP
      </button>
      {open ? (
        <div className="modalOverlay" onClick={() => setOpen(false)}>
          <div
            className="modalContent"
            style={{ maxWidth: 560, width: "90%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modalCloseBtn"
              onClick={() => setOpen(false)}
              aria-label="Close"
              type="button"
            >
              ×
            </button>
            <div
              style={{
                maxHeight: "70vh",
                overflowY: "auto",
                paddingRight: 8,
                marginTop: 8,
              }}
            >
              <MvpVotingPanel eventId={eventId} variant="inline" />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}


