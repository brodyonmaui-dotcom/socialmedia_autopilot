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
 * Light/dark switch. `variant="icon"`: 44px sun/moon button for top bars. `variant="row"`: labelled Toggle
 * ("Light theme") for settings cards. Pass the server-read theme as `initial` (getTheme()).
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
          label="Light theme"
          description="Dark stays the default; this only changes this device."
          checked={theme === "light"}
          onChange={(on) => set(on ? "light" : "dark")}
        />
      </span>
    );
  }
  const next = otherTheme(theme);
  return (
    <span ref={ref} className="inline-flex">
      <button
        type="button"
        onClick={() => set(next)}
        aria-label={`Switch to ${next} theme`}
        title={`Switch to ${next} theme`}
        className={cx(
          "inline-flex size-11 items-center justify-center rounded-ds-md bg-ds-raised text-ds-muted transition-colors duration-200 ease-ds hover:text-ds-text",
          FOCUS,
        )}
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
      </button>
    </span>
  );
}
