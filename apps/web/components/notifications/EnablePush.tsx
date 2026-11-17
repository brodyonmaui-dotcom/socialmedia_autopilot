"use client";

import { useEffect, useState } from "react";
import { Button, Card, Chip, Icon, cx } from "../ui/index.js";
import { pushPulse } from "../../lib/alerts/view.js";
import { sendTestAction, subscribeAction, unsubscribeAction, type PushActionResult } from "../../app/alerts/push-actions.js";
import { SW_SCOPE, SW_URL, deviceLabel, pushSupport, urlBase64ToUint8Array, type PushSupport } from "./push-client.js";

const HINT: Record<Exclude<PushSupport, "ok">, string> = {
  "no-key": "Notifications aren't set up on the server yet (VAPID keys: see the alerts-push runbook).",
  "not-installed": "To get notifications on iPhone, add this app to the Home Screen (Share → Add to Home Screen), open it from there, then tap Enable.",
  unsupported: "This browser can't receive push notifications.",
  denied: "Notifications are blocked for this app. Allow them in Settings → Notifications, then come back.",
};

/** Static status dot (hard rule 2: nothing pulses); the word next to it carries the meaning. */
const DOT = { accent: "bg-ds-accent", warn: "bg-ds-warn", muted: "bg-ds-muted" } as const;

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
    <Card title="Push notifications" titleId="push-title" subtitle="Urgent alerts are pushed to the phone: how many and what kind, never the alert text.">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-ds-text">
            <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", DOT[pulse.tone])} />
            {pulse.label}
          </span>
          {support && support !== "ok" ? (
            <Chip tone="warn" wrap>
              {HINT[support]}
            </Chip>
          ) : null}
          <p className="ds-num text-[13px] text-ds-muted">{activeCount === 1 ? "1 device subscribed" : `${activeCount} devices subscribed`}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:w-64 sm:shrink-0">
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
              <Button variant="outline" block disabled={busy || subscribed === null} onClick={enable}>
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
    </Card>
  );
}
