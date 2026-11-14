"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import { AlertCard, Button, Icon, Input } from "../../components/ui/index.js";
import { beginLoginAction, beginRegistrationAction, finishLoginAction, finishRegistrationAction } from "./actions.js";

/** Short, non-identifying device label for the passkey list. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "device";
}

/** The browser's own error (user cancelled, no authenticator) as a short line; never the response. */
function browserError(err: unknown): string {
  const name = (err as { name?: string }).name;
  if (name === "NotAllowedError") return "cancelled or timed out";
  if (name === "InvalidStateError") return "this device is already added";
  return "passkey not available on this browser";
}

export function PasskeyPanel({ hasCredentials }: { hasCredentials: boolean }) {
  const [canLogin, setCanLogin] = useState(hasCredentials);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function login() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const begin = await beginLoginAction();
      if (!begin.ok) return setError(begin.error);
      let response;
      try {
        response = await startAuthentication({ optionsJSON: begin.options });
      } catch (err) {
        return setError(browserError(err));
      }
      const done = await finishLoginAction(begin.challengeId, response);
      if (!done.ok) return setError(done.error);
      window.location.assign("/app/batches");
    } finally {
      setBusy(false);
    }
  }

  async function addDevice() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const begin = await beginRegistrationAction(code);
      if (!begin.ok) return setError(begin.error);
      let response;
      try {
        response = await startRegistration({ optionsJSON: begin.options });
      } catch (err) {
        return setError(browserError(err));
      }
      const done = await finishRegistrationAction(begin.challengeId, response, deviceLabel());
      if (!done.ok) return setError(done.error);
      setCode("");
      setCanLogin(true);
      setInfo("Added. Now log in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {(error || info) && (
        <div className="border-b border-ds-line py-6" aria-live="polite">
          {error && (
            <AlertCard tone="light" title="Couldn't sign in" live>
              {error}
            </AlertCard>
          )}
          {info && (
            <p className="flex items-center gap-2 border border-ds-line bg-ds-card p-5 ds-caps text-ds-text">
              <Icon name="check" size={16} strokeWidth={2} className="text-ds-accent-fg" />
              {info}
            </p>
          )}
        </div>
      )}

      {canLogin && (
        <section aria-label="Sign in" className="border-b border-ds-line py-8">
          <Button variant="solid" block arrow disabled={busy} aria-busy={busy || undefined} onClick={login}>
            {busy ? "Waiting for passkey" : "Use passkey"}
          </Button>
          <p className="mt-3 text-center ds-mono text-ds-faint">FACE ID · TOUCH ID · SECURITY KEY</p>
        </section>
      )}

      <section aria-labelledby="add-device" className="py-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="add-device" className="ds-caps text-ds-text">
            Add this device
          </h2>
          <span className="ds-mono text-ds-faint">{canLogin ? "OPTIONAL" : "STEP 01"}</span>
        </div>
        <p className="mt-3 text-[15px] leading-snug text-ds-muted">
          On the server run <code className="ds-mono text-ds-text">pnpm auth:enroll</code>, then type the code here.
        </p>
        <Input
          className="mt-5"
          label="Enrollment code"
          name="code"
          placeholder="XXXX-XXXX"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          autoCorrect="off"
          spellCheck={false}
          maxLength={12}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button
          variant={canLogin ? "outline" : "solid"}
          block
          className="mt-4"
          disabled={busy || code.trim().length < 8}
          onClick={addDevice}
        >
          Add this device
        </Button>
      </section>
    </div>
  );
}
