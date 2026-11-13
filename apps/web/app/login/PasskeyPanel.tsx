"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import { beginLoginAction, beginRegistrationAction, finishLoginAction, finishRegistrationAction } from "./actions.js";

const button =
  "min-h-12 w-full rounded-lg bg-neutral-900 px-4 text-base font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900";

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
    <div className="mt-8 space-y-10">
      {canLogin && (
        <section>
          <button type="button" className={button} disabled={busy} onClick={login}>
            Log in with passkey
          </button>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Add this device</h2>
        <p className="text-sm text-neutral-500">
          On the server run <code>pnpm auth:enroll</code>, then type the code here.
        </p>
        <input
          className="min-h-12 w-full rounded-lg border border-neutral-300 bg-transparent px-3 text-lg tracking-widest uppercase dark:border-neutral-700"
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
        <button type="button" className={button} disabled={busy || code.trim().length < 8} onClick={addDevice}>
          Add this device
        </button>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {info && <p className="text-sm text-green-700 dark:text-green-400">{info}</p>}
    </div>
  );
}
