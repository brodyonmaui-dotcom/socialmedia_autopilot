import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cx, FOCUS } from "./cx.js";

export type ButtonVariant = "solid" | "accent" | "outline" | "white" | "ghost" | "icon" | "pill";
export type ButtonSize = "md" | "sm";
export type ButtonTone = "default" | "danger";

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  tone?: ButtonTone;
  disabled?: boolean;
  /** Adds `group` so a trailing ButtonArrow can rotate on hover. */
  arrow?: boolean;
  className?: string;
}

const BASE =
  "inline-flex items-center justify-center gap-2 select-none whitespace-nowrap transition-colors duration-300 ease-ds";

/** v2 Warm Industrial: sharp rectangles; only `pill` is round. */
const VARIANT: Record<ButtonVariant, string> = {
  solid: "bg-ds-invert text-ds-on-invert ds-caps hover:bg-ds-accent hover:text-ds-ink",
  accent: "bg-ds-accent text-ds-ink ds-caps hover:bg-ds-accent-hi",
  outline: "border border-ds-text/80 text-ds-text ds-caps hover:bg-ds-text hover:text-ds-bg",
  white: "bg-ds-card text-ds-text ds-caps border border-ds-line hover:bg-ds-raised",
  ghost: "text-ds-accent-fg ds-caps hover:bg-ds-raised",
  icon: "size-11 shrink-0 border border-ds-line text-ds-text hover:bg-ds-raised",
  pill: "rounded-full border border-ds-text text-ds-text ds-caps hover:bg-ds-text hover:text-ds-bg",
};

/** Danger tone: a danger-coloured line (inverts on hover); ghost gets danger text. Solid/accent keep their fill. */
const DANGER: Partial<Record<ButtonVariant, string>> = {
  outline: "border border-ds-danger/50 text-ds-danger ds-caps hover:bg-ds-danger hover:text-ds-bg",
  white: "bg-ds-card border border-ds-danger/50 text-ds-danger ds-caps hover:bg-ds-raised",
  icon: "size-11 shrink-0 border border-ds-danger/50 text-ds-danger hover:bg-ds-raised",
  pill: "rounded-full border border-ds-danger/50 text-ds-danger ds-caps hover:bg-ds-danger hover:text-ds-bg",
  ghost: "text-ds-danger ds-caps hover:bg-ds-raised",
};

const SIZE: Record<ButtonSize, string> = {
  md: "h-12 px-6",
  sm: "h-11 px-6",
};

/** Pure class builder shared by Button, ButtonLink and tests. */
export function buttonClasses(opts: ButtonClassOptions = {}): string {
  const { variant = "solid", size = "md", block = false, tone = "default", disabled = false, arrow = false, className } = opts;
  const danger = tone === "danger";
  // Destructive tone swaps the colour classes (no stacked conflicting utilities).
  const look = danger && DANGER[variant] ? DANGER[variant] : VARIANT[variant];
  return cx(
    BASE,
    FOCUS,
    look,
    variant === "pill" ? "h-11 px-5" : variant !== "icon" && SIZE[size],
    block && variant !== "icon" && "w-full",
    arrow && "group",
    disabled && "opacity-50 cursor-not-allowed",
    className,
  );
}

/** Trailing ↗ arrow (16px) that rotates from -45deg to 0 on hover of the parent `group`. */
export function ButtonArrow({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="square"
      className={cx("shrink-0 -rotate-45 transition-transform duration-[600ms] ease-ds group-hover:rotate-0", className)}
    >
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

type VisualProps = Omit<ButtonClassOptions, "disabled" | "className" | "variant">;

/** `variant="icon"` has no visible text, so it must carry an aria-label. */
type VariantProps =
  | { variant?: Exclude<ButtonVariant, "icon">; "aria-label"?: string }
  | { variant: "icon"; "aria-label": string };

export type ButtonProps = VisualProps & VariantProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

function withArrow(children: ReactNode, arrow: boolean | undefined) {
  if (!arrow) return children;
  return (
    <>
      {children}
      <ButtonArrow />
    </>
  );
}

export function Button({ variant, size, block, tone, arrow, className, disabled, type = "button", children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={buttonClasses({ variant, size, block, tone, disabled, arrow, className })}
      {...rest}
    >
      {withArrow(children, arrow)}
    </button>
  );
}

export type ButtonLinkProps = VisualProps &
  VariantProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "aria-label" | "href"> & { href: ComponentProps<typeof Link>["href"] };

export function ButtonLink({ variant, size, block, tone, arrow, className, href, children, ...rest }: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClasses({ variant, size, block, tone, arrow, className })} {...rest}>
      {withArrow(children, arrow)}
    </Link>
  );
}
