"use client";

import { useState } from "react";
import { Button, type ButtonVariant } from "./Button.js";
import { Icon } from "./Icon.js";

/**
 * Copies `text` to the clipboard; the label confirms in place ("Copied", announced) for 2 s.
 * `onCopied` runs after a successful copy (e.g. a server action that records it).
 */
export function CopyButton({
  text,
  onCopied,
  label = "Copy",
  variant = "outline",
  size = "sm",
}: {
  text: string;
  onCopied?: () => Promise<void> | void;
  label?: string;
  variant?: Exclude<ButtonVariant, "icon">;
  size?: "sm" | "md";
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
          if (onCopied) await onCopied();
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Icon name="check" size={16} /> : null}
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </Button>
  );
}
