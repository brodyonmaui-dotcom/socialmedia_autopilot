"use client";

import { useEffect, useState } from "react";
import { BTN_GHOST, BTN_PRIMARY } from "../../batches/ui/WarningChip.js";
import { sendTestAction, subscribeAction, unsubscribeAction, type PushActionResult } from "../push-actions.js";
import { SW_SCOPE, SW_URL, deviceLabel, pushSupport, urlBase64ToUint8Array, type PushSupport } from "./push-client.js";

const HINT: Record<Exclude<PushSupport, "ok">, string> = {
  "no-key": "Notifications aren't set up on the server yet (VAPID keys: see the alerts-push runbook).",
  "not-installed": "To get notifications on iPhone, add this app to the Home Screen (Share → Add to Home Screen), open it from there, then tap Enable.",
  unsupported: "This browser can't receive push notifications.",
  denied: "Notifications are blocked for this app. Allow them in Settings → Notifications, then come back.",
};

/**
 * "Enable notifications" (F8). The subscription is only ever created from a tap (iOS requires a user
 * gesture). The VAPID public key comes from the server component at runtime, not NEXT_PUBLIC_*.
 */
export function EnablePush({ vapidPublicKey, activeCount }: { vapidPublicKey: string | null; activeCount: number }) {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const s = pushSupport({
      hasKey: !!vapidPublicKey,
      hasServiceWorker: "serviceWorker" in navigator,
      hasPushManager: "PushManager" in window,
      standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
      ios: /iPhone|iPad/.test(navigator.userAgent),
      permission: "Notification" in window ? Notification.permission : null,
    });
    setSupport(s);
    if (s !== "ok") return;
    navigator.serviceWorker
      .getRegistration(SW_SCOPE)
      .then((reg) => reg?.pushManager.getSubscription())
      // A browser subscription the server no longer has (e.g. after "Log out everywhere") shows Enable again.
      .then((sub) => setSubscribed(!!sub && activeCount > 0))
      .catch(() => setSubscribed(false));
  }, [vapidPublicKey, activeCount]);

  async function act(fn: () => Promise<PushActionResult | string>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (typeof r === "string") setMsg({ ok: true, text: r });
      else setMsg(r.ok ? { ok: true, text: r.note ?? "Done." } : { ok: false, text: r.reason.slice(0, 160) });
    } catch {
      setMsg({ ok: false, text: "Something went wrong: reload and try again." });
    } finally {
      setBusy(false);
    }
  }

  // Runs inside the tap handler: permission first, while the user gesture is still fresh.
  const enable = () =>
    act(async () => {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        if (perm === "denied") setSupport("denied");
        return { ok: false, reason: "Notifications weren't allowed." };
      }
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!) }));
      const r = await subscribeAction(sub.toJSON(), deviceLabel(navigator.userAgent));
      if (r.ok) setSubscribed(true);
      return r.ok ? "Notifications on for this device." : r;
    });

  const disable = () =>
    act(async () => {
      const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await unsubscribeAction(endpoint);
      }
      setSubscribed(false);
      return "Notifications off for this device.";
    });

  return (
    <section className="mt-8 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <h2 className="font-semibold">Notifications</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Urgent alerts are pushed to the phone (count and kind only, never the alert text). {activeCount} device{activeCount === 1 ? "" : "s"} subscribed.
      </p>
      {support && support !== "ok" ? <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">{HINT[support]}</p> : null}
      {support === "ok" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {subscribed ? (
            <>
              <button type="button" className={`${BTN_PRIMARY} flex-1`} disabled={busy} onClick={() => act(() => sendTestAction())}>
                Send test notification
              </button>
              <button type="button" className={BTN_GHOST} disabled={busy} onClick={disable}>
                Turn off
              </button>
            </>
          ) : (
            <button type="button" className={`${BTN_PRIMARY} flex-1`} disabled={busy || subscribed === null} onClick={enable}>
              Enable notifications
            </button>
          )}
        </div>
      ) : null}
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
