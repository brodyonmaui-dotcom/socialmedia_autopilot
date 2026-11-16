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
  "inline-flex items-center justify-center gap-2 select-none whitespace-nowrap font-semibold transition-colors duration-[var(--ds-dur)] ease-ds";

/**
 * v3: sentence-case Inter 600 labels, 8 px radius. One `solid` (ink) button per view; everything else is
 * outline or ghost. `pill` is the only round variant. `accent` and `white` are v2 leftovers.
 */
const VARIANT: Record<ButtonVariant, string> = {
  solid: "rounded-ds-sm bg-ds-invert text-ds-on-invert hover:bg-ds-invert/85",
  accent: "rounded-ds-sm bg-ds-accent text-ds-ink hover:bg-ds-accent-hi",
  outline: "rounded-ds-sm border border-ds-line-strong text-ds-text hover:bg-ds-raised",
  white: "rounded-ds-sm border border-ds-line bg-ds-card text-ds-text hover:bg-ds-raised",
  ghost: "rounded-ds-sm text-ds-text hover:bg-ds-raised",
  icon: "size-11 shrink-0 rounded-ds-sm border border-ds-line text-ds-text hover:bg-ds-raised",
  pill: "rounded-full border border-ds-line-strong text-ds-text hover:bg-ds-raised",
};

/** Danger tone: danger text and line; fills only on hover as a raised well. Solid/accent keep their fill. */
const DANGER: Partial<Record<ButtonVariant, string>> = {
  outline: "rounded-ds-sm border border-ds-danger/60 text-ds-danger hover:bg-ds-raised",
  white: "rounded-ds-sm border border-ds-danger/60 bg-ds-card text-ds-danger hover:bg-ds-raised",
  icon: "size-11 shrink-0 rounded-ds-sm border border-ds-danger/60 text-ds-danger hover:bg-ds-raised",
  pill: "rounded-full border border-ds-danger/60 text-ds-danger hover:bg-ds-raised",
  ghost: "rounded-ds-sm text-ds-danger hover:bg-ds-raised",
};

/** Both sizes stay ≥ 44 px tall on phones; `sm` tightens to 36 px on desktop. */
const SIZE: Record<ButtonSize, string> = {
  md: "h-11 px-5 text-[15px]",
  sm: "h-11 px-4 text-[14px] lg:h-9 lg:px-3.5",
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
    variant === "pill" ? "h-11 px-5 text-[14px]" : variant !== "icon" && SIZE[size],
    block && variant !== "icon" && "w-full",
    arrow && "group",
    disabled && "opacity-50 cursor-not-allowed",
    className,
  );
}

/** Trailing → arrow (16 px), static (v3: hover changes colour only, nothing rotates). */
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
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("shrink-0", className)}
    >
      <path d="M4 12h16M14 6l6 6-6 6" />
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
