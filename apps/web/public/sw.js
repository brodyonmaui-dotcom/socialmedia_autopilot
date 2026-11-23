/* autopilot service worker (F8): Web Push only. No fetch handler, no caching, no data stored.
 * Served at /app/sw.js with scope /app/ (public/ under basePath /app; the middleware lets it through).
 * The payload carries only {count, kinds[], sources[], url} (never alert text), so the notification
 * shows a count + kind names; a tap opens /app/notifications. One exception (run 4): a push made only of
 * `reply-ready` alerts may carry a privacy-linted `body` (shown as the text) and an inbox `url`, which a tap
 * opens only when it is a same-app path under /app/inbox. Likewise a push made only of `auto-scheduled`
 * alerts carries its "Scheduled: <title> at <time>" body (title "Scheduled") and opens /app/calendar.
 * Anything else opens the default. */

const DEFAULT_URL = "/app/notifications";
/** Same-origin app path under /app/inbox (no scheme, no //, no ..), else null. */
function inboxUrl(u) {
  return typeof u === "string" && /^\/app\/inbox(\/[A-Za-z0-9_-]+)*\/?$/.test(u) ? u : null;
}
const CALENDAR_URL = "/app/calendar";
/** An inbox path or exactly the calendar, else null. */
function allowedUrl(u) {
  return inboxUrl(u) || (u === CALENDAR_URL ? u : null);
}
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
  "reply-ready": "Reply ready",
  "auto-scheduled": "Scheduled",
  "batch-ready": "Next week drafted",
  "report-ready": "Weekly report",
  "missed-slot": "Missed post",
  "trial-reels-ready": "Trial reels",
};

function notificationView(data) {
  const d = data && typeof data === "object" ? data : {};
  if (d.test === true) return { title: "Test notification", body: "Alerts will arrive like this.", url: DEFAULT_URL };
  const count = Number.isInteger(d.count) && d.count > 0 ? d.count : 1;
  const raw = Array.isArray(d.kinds) ? d.kinds.filter((k) => Object.prototype.hasOwnProperty.call(KIND_LABELS, k)) : [];
  if (raw.length > 0 && raw.every((k) => k === "reply-ready")) {
    const body = typeof d.body === "string" && d.body.trim() ? d.body.trim().slice(0, 200) : count === 1 ? "A comment is waiting for your reply." : `${count} comments are waiting for your reply.`;
    return { title: count === 1 ? "Reply ready" : `${count} replies ready`, body, url: inboxUrl(d.url) || DEFAULT_URL };
  }
  if (raw.length > 0 && raw.every((k) => k === "auto-scheduled")) {
    const body = typeof d.body === "string" && d.body.trim() ? d.body.trim().slice(0, 200) : count === 1 ? "A post was scheduled." : `${count} posts scheduled`;
    return { title: "Scheduled", body, url: CALENDAR_URL };
  }
  const kinds = raw.map((k) => KIND_LABELS[k]);
  return { title: count === 1 ? "1 new alert" : `${count} new alerts`, body: kinds.length ? kinds.join(" · ") : "Open alerts", url: DEFAULT_URL };
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
      data: { url: view.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const target = allowedUrl(data && data.url) || DEFAULT_URL;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (typeof w.navigate === "function" && typeof w.focus === "function") {
          try {
            await w.navigate(target); // throws for a window this worker doesn't control
            return await w.focus();
          } catch (_) {
            /* try the next window, else open one */
          }
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
