import type { ReactNode } from "react";

type Props = {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
};

/**
 * Standardised empty-state block used when a list or page has no data to show.
 * Keeps tone-of-voice and spacing consistent across attendance, trainer,
 * feedback and admin lists.
 */
export default function EmptyState({ title, body, action, icon }: Props) {
  return (
    <div
      className="card"
      role="status"
      style={{
        textAlign: "center",
        padding: "var(--space-6) var(--space-4)",
      }}
    >
      {icon ? (
        <div style={{ fontSize: 28, marginBottom: 4 }}>{icon}</div>
      ) : null}
      <div style={{ fontWeight: 600 }}>{title}</div>
      {body ? (
        <div className="muted" style={{ marginTop: 4 }}>
          {body}
        </div>
      ) : null}
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}
