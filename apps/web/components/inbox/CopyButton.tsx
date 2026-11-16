"use client";

import { useState } from "react";
import { Button, Icon, type ButtonVariant } from "../ui/index.js";

/** Copies text to the clipboard; `onCopied` runs after (marks a DM draft copied). The label confirms in place. */
export function CopyButton({
  text,
  onCopied,
  label = "Copy",
  variant = "outline",
}: {
  text: string;
  onCopied?: () => Promise<void>;
  label?: string;
  variant?: Exclude<ButtonVariant, "icon">;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant={variant}
      size="sm"
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
