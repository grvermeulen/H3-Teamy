import type { CSSProperties, ReactNode } from "react";

type Gap = "1" | "2" | "3" | "4" | "6";
type Direction = "row" | "column";
type Align = "start" | "center";
type Justify = "between" | "end" | "center";

type Props = {
  children: ReactNode;
  direction?: Direction;
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "section" | "header" | "footer" | "nav";
};

/**
 * Layout primitive that wraps children in a flex container with a token-driven
 * gap and direction. Replaces ad-hoc inline `display:flex;gap:X` snippets.
 *
 * @param children - Elements to lay out.
 * @param direction - Stack axis (`column` by default).
 * @param gap - Spacing token (`1`–`6`, mapped to `--space-*`).
 * @param align - `align-items` shortcut.
 * @param justify - `justify-content` shortcut.
 * @param className - Optional extra className appended to `ui-stack`.
 * @param style - Escape-hatch inline style.
 * @param as - Tag override for semantic markup.
 */
export default function Stack({
  children,
  direction = "column",
  gap = "3",
  align,
  justify,
  className,
  style,
  as: Tag = "div",
}: Props) {
  return (
    <Tag
      className={`ui-stack${className ? ` ${className}` : ""}`}
      data-direction={direction}
      data-gap={gap}
      data-align={align}
      data-justify={justify}
      style={style}
    >
      {children}
    </Tag>
  );
}
