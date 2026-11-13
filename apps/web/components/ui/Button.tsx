import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps } from "react";
import { cx, FOCUS } from "./cx.js";

export type ButtonVariant = "solid" | "outline" | "white" | "ghost" | "icon";
export type ButtonSize = "md" | "sm";
export type ButtonTone = "default" | "danger";

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  tone?: ButtonTone;
  disabled?: boolean;
  className?: string;
}

const BASE =
  "inline-flex items-center justify-center gap-2 select-none whitespace-nowrap transition duration-200 ease-ds active:scale-[0.98]";

const VARIANT: Record<ButtonVariant, string> = {
  solid: "bg-ds-accent text-ds-ink ds-caps font-bold rounded-ds-md hover:bg-ds-accent-hi",
  outline: "border border-ds-line-strong text-ds-text rounded-ds-md font-bold hover:bg-ds-raised",
  white: "bg-ds-paper text-ds-ink ds-caps font-bold rounded-ds-md hover:bg-ds-paper-2",
  ghost: "text-ds-accent rounded-ds-md font-bold hover:bg-ds-raised",
  icon: "size-11 shrink-0 rounded-ds-md bg-ds-raised text-ds-text hover:bg-ds-line",
};

const SIZE: Record<ButtonSize, string> = {
  md: "h-12 px-5",
  sm: "h-11 px-4 text-[13px]",
};

/** Pure class builder shared by Button, ButtonLink and tests. */
export function buttonClasses(opts: ButtonClassOptions = {}): string {
  const { variant = "solid", size = "md", block = false, tone = "default", disabled = false, className } = opts;
  const danger = tone === "danger";
  return cx(
    BASE,
    FOCUS,
    VARIANT[variant],
    variant !== "icon" && SIZE[size],
    block && variant !== "icon" && "w-full",
    // Destructive actions are an outline in coral (ghost gets coral text too).
    danger && (variant === "outline" || variant === "icon") && "text-ds-danger border border-ds-danger/50",
    danger && variant === "ghost" && "text-ds-danger",
    disabled && "opacity-50 cursor-not-allowed active:scale-100",
    className,
  );
}

type VisualProps = Omit<ButtonClassOptions, "disabled" | "className" | "variant">;

/** `variant="icon"` has no visible text, so it must carry an aria-label. */
type VariantProps =
  | { variant?: Exclude<ButtonVariant, "icon">; "aria-label"?: string }
  | { variant: "icon"; "aria-label": string };

export type ButtonProps = VisualProps & VariantProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

export function Button({ variant, size, block, tone, className, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={buttonClasses({ variant, size, block, tone, disabled, className })}
      {...rest}
    />
  );
}

export type ButtonLinkProps = VisualProps &
  VariantProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "aria-label" | "href"> & { href: ComponentProps<typeof Link>["href"] };

export function ButtonLink({ variant, size, block, tone, className, href, ...rest }: ButtonLinkProps) {
  return <Link href={href} className={buttonClasses({ variant, size, block, tone, className })} {...rest} />;
}
