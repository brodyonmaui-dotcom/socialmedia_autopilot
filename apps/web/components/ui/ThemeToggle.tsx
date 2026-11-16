"use client";

import { useRef, useState } from "react";
import { Icon } from "./Icon.js";
import { iconButtonClasses } from "./IconButton.js";
import { Toggle } from "./Toggle.js";
import { otherTheme, themeCookie, type Theme } from "./theme.js";

/** Applies the theme to the nearest .ds-root right away and remembers it in a cookie for server renders. */
function apply(from: Element | null, t: Theme) {
  const root = from?.closest(".ds-root") ?? document.querySelector(".ds-root");
  root?.setAttribute("data-theme", t);
  document.cookie = themeCookie(t);
}

/**
 * Day/Night switch. `variant="icon"`: the top bar's 40 px icon button (moon in Day, sun in Night).
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
        className={iconButtonClasses()}
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
      </button>
    </span>
  );
}
