"use client";

import { useRef, useState } from "react";
import { cx, FOCUS } from "./cx.js";
import { Icon } from "./Icon.js";
import { Toggle } from "./Toggle.js";
import { otherTheme, themeCookie, type Theme } from "./theme.js";

/** Applies the theme to the nearest .ds-root right away and remembers it in a cookie for server renders. */
function apply(from: Element | null, t: Theme) {
  const root = from?.closest(".ds-root") ?? document.querySelector(".ds-root");
  root?.setAttribute("data-theme", t);
  document.cookie = themeCookie(t);
}

/**
 * Day/Night switch. `variant="icon"`: sharp 44px square (moon in Day, sun in Night) for the header.
 * `variant="row"`: labelled Toggle ("Night theme") for settings cards. Pass the server-read theme as
 * `initial` (getTheme()).
 */
export function ThemeToggle({ initial, variant = "icon" }: { initial: Theme; variant?: "icon" | "row" }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const ref = useRef<HTMLSpanElement>(null);
  const set = (t: Theme) => {
    setTheme(t);
    apply(ref.current, t);
  };

  if (variant === "row") {
    return (
      <span ref={ref} className="block">
        <Toggle
          label="Night theme"
          description="Day stays the default; this only changes this device."
          checked={theme === "dark"}
          onChange={(on) => set(on ? "dark" : "light")}
        />
      </span>
    );
  }
  const next = otherTheme(theme);
  const label = next === "dark" ? "Switch to night theme" : "Switch to day theme";
  return (
    <span ref={ref} className="inline-flex">
      <button
        type="button"
        onClick={() => set(next)}
        aria-label={label}
        title={label}
        className={cx(
          "inline-flex size-11 items-center justify-center border border-ds-line text-ds-text transition-colors duration-[var(--ds-dur)] ease-ds hover:bg-ds-raised",
          FOCUS,
        )}
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
      </button>
    </span>
  );
}
