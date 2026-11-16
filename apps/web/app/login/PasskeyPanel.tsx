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
      window.location.assign("/app/");
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

  const addDevice_ = (
    <>
      <p className="text-[14px] leading-snug text-ds-muted">
        On the server run <code className="font-[inherit] font-semibold text-ds-text">pnpm auth:enroll</code>, then type the code here.
      </p>
      <Input
        className="mt-4"
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
      <Button variant={canLogin ? "outline" : "solid"} block className="mt-3" disabled={busy || code.trim().length < 8} onClick={addDevice}>
        Add this device
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {(error || info) && (
        <div aria-live="polite">
          {error && (
            <AlertCard title="Couldn't sign in" live>
              {error}
            </AlertCard>
          )}
          {info && (
            <p className="flex items-center gap-2 rounded-ds-sm bg-ds-raised px-3 py-2.5 text-[14px] text-ds-text">
              <Icon name="check" size={16} className="shrink-0 text-ds-accent-fg" />
              {info}
            </p>
          )}
        </div>
      )}

      {canLogin && (
        <section aria-label="Sign in">
          <Button variant="solid" block disabled={busy} aria-busy={busy || undefined} onClick={login}>
            {busy ? "Waiting for passkey…" : "Use passkey"}
          </Button>
          <p className="mt-2 text-center text-[13px] text-ds-muted">Face ID, Touch ID or a security key.</p>
        </section>
      )}

      {canLogin ? (
        <details className="group border-t border-ds-line pt-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-ds-sm text-[14px] font-semibold text-ds-muted hover:text-ds-text [&::-webkit-details-marker]:hidden">
            Add this device
            <Icon name="chevronDown" size={16} className="group-open:rotate-180" />
          </summary>
          <section aria-label="Add this device" className="pb-1 pt-2">
            {addDevice_}
          </section>
        </details>
      ) : (
        <section aria-labelledby="add-device">
          <h2 id="add-device" className="mb-2 text-[15px] font-semibold text-ds-text">
            Add this device
          </h2>
          {addDevice_}
        </section>
      )}
    </div>
  );
}
