"use client";

import { useEffect, useState } from "react";
import { Button, CONTAINER, Chip, Icon, Readout, StatusPulse, cx } from "../../../components/ui/index.js";
import { pushPulse } from "../../../lib/alerts/view.js";
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

  const pulse = pushPulse(support, subscribed);

  return (
    <div className="border-b border-ds-line">
      <div className={cx(CONTAINER, "grid grid-cols-4 lg:grid-cols-12")}>
        <div className="col-span-4 flex min-w-0 flex-col gap-4 py-6 lg:col-span-7 lg:py-10 lg:pr-10">
          <StatusPulse tone={pulse.tone} label={pulse.label} />
          <p className="text-[18px] font-bold leading-snug tracking-[-0.01em]">Urgent alerts are pushed to the phone.</p>
          <p className="ds-note">The notification says how many and what kind, never the alert text.</p>
          {support && support !== "ok" ? (
            <Chip tone="warn" wrap>
              {HINT[support]}
            </Chip>
          ) : null}
          <Readout items={[{ k: "Devices", v: `${activeCount} subscribed` }]} />
        </div>
        <div className="col-span-4 flex min-w-0 flex-col justify-center gap-2 pb-6 lg:col-span-5 lg:border-l lg:border-ds-line lg:py-10 lg:pl-10">
          {support === "ok" ? (
            subscribed ? (
              <>
                <Button variant="outline" block disabled={busy} onClick={() => act(() => sendTestAction())}>
                  Send test notification
                </Button>
                <Button variant="ghost" block disabled={busy} onClick={disable}>
                  Turn off on this device
                </Button>
              </>
            ) : (
              <Button variant="solid" block arrow disabled={busy || subscribed === null} onClick={enable}>
                Enable notifications
              </Button>
            )
          ) : null}
          {msg ? (
            <p role={msg.ok ? "status" : "alert"} className={cx("flex items-start gap-2 text-[15px] leading-snug", msg.ok ? "text-ds-accent-fg" : "text-ds-danger")}>
              <Icon name={msg.ok ? "check" : "alert"} size={16} className="mt-0.5 shrink-0" />
              {msg.text}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
