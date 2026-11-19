// Service worker for streak reminders. It does nothing else: no caching, no
// offline. The push carries no payload (see scripts/send-streak-reminders.mjs),
// so the text is fixed here.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("Your streak ends tonight", {
      body: "Play today's puzzle before midnight to keep it going.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "streak-reminder",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => "focus" in w);
      return open ? open.focus() : self.clients.openWindow("/");
    })
  );
});
