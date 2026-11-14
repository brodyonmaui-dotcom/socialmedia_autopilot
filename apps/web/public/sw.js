/* autopilot service worker (F8): Web Push only. No fetch handler, no caching, no data stored.
 * Served at /app/sw.js with scope /app/ (public/ under basePath /app; the middleware lets it through).
 * The payload carries only {count, kinds[], sources[], url} (never alert text), so the notification
 * shows a count + kind names; a tap always opens /app/alerts, whatever the payload says. */

const ALERTS_URL = "/app/alerts";
// Same labels as apps/web/lib/alerts/queries.ts (a test keeps them in sync).
const KIND_LABELS = {
  "final-failure": "Failed",
  "unknown-outcome": "Unknown outcome",
  "cap-breach": "Cap reached",
  duplicate: "Duplicate",
  "token-health": "Token health",
  auth: "Login",
  "engagement-kill": "Engagement stopped",
  "engagement-failure": "Engagement failed",
  "engagement-unknown": "Engagement unknown",
  "engagement-mode": "Engagement mode",
  "metrics-health": "Metrics",
  config: "Configuration",
  "ready-for-approval": "Ready for approval",
  "settings-change": "Settings change",
};

function notificationView(data) {
  const d = data && typeof data === "object" ? data : {};
  if (d.test === true) return { title: "Test notification", body: "Alerts will arrive like this." };
  const count = Number.isInteger(d.count) && d.count > 0 ? d.count : 1;
  const kinds = Array.isArray(d.kinds) ? d.kinds.filter((k) => Object.prototype.hasOwnProperty.call(KIND_LABELS, k)).map((k) => KIND_LABELS[k]) : [];
  return { title: count === 1 ? "1 new alert" : `${count} new alerts`, body: kinds.length ? kinds.join(" · ") : "Open alerts" };
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = {};
  }
  const view = notificationView(data);
  event.waitUntil(
    self.registration.showNotification(view.title, {
      body: view.body,
      tag: "autopilot-alerts",
      renotify: true,
      icon: "/app/icons/icon-192.png",
      data: { url: ALERTS_URL },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (typeof w.navigate === "function" && typeof w.focus === "function") {
          try {
            await w.navigate(ALERTS_URL); // throws for a window this worker doesn't control
            return await w.focus();
          } catch (_) {
            /* try the next window, else open one */
          }
        }
      }
      return self.clients.openWindow(ALERTS_URL);
    })(),
  );
});
