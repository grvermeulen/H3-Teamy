"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  isFullWidth?: boolean;
  loading?: boolean;
  loadingLabel?: string;
};

/**
 * Themed button used across the app. Standardises hit area, focus ring,
 * disabled and loading states so individual screens never have to restyle a
 * `<button>` inline.
 *
 * @param children - Button label.
 * @param variant - Visual emphasis (`primary` | `secondary` | `ghost` | `danger`).
 * @param size - Height/typography preset (`md` is the default 44px tap target).
 * @param isFullWidth - Stretch to the parent's width — useful inside cards on mobile.
 * @param loading - Render the loading label and disable the button.
 * @param loadingLabel - Optional label shown while `loading` is true.
 */
export default function Button({
  children,
  variant = "secondary",
  size = "md",
  isFullWidth,
  loading,
  loadingLabel,
  disabled,
  className,
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      data-fullwidth={isFullWidth ? "true" : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`ui-btn${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {loading ? (loadingLabel ?? children) : children}
    </button>
  );
}
