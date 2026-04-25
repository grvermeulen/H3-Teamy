import type { CSSProperties, ReactNode } from "react";

type Props = {
  children: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "section" | "article" | "li";
};

/**
 * Container with the app's standard card chrome. Optional `title` + `actions`
 * render a consistent header row so screens don't have to hand-build a
 * `<div class="row" style="justify-content: space-between">` each time.
 *
 * @param children - Card body.
 * @param title - Optional header content (typically a heading or label).
 * @param actions - Optional trailing controls rendered next to `title`.
 * @param selected - Highlights the card with the accent border (e.g. selected list item).
 * @param className - Extra className appended to `.card`.
 * @param style - Escape-hatch inline style.
 * @param as - Tag override for semantic markup.
 */
export default function Card({
  children,
  title,
  actions,
  selected,
  className,
  style,
  as: Tag = "div",
}: Props) {
  return (
    <Tag
      className={`card${className ? ` ${className}` : ""}`}
      style={{
        borderColor: selected ? "var(--accent)" : undefined,
        ...style,
      }}
    >
      {title || actions ? (
        <div
          className="ui-stack"
          data-direction="row"
          data-justify="between"
          data-align="center"
          data-gap="2"
          style={{ marginBottom: "var(--space-3)" }}
        >
          <div style={{ minWidth: 0 }}>{title}</div>
          {actions ? (
            <div className="ui-stack" data-direction="row" data-gap="2">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}
