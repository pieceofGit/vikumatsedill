// Only here so the page can raise system notifications (Android Chrome refuses
// `new Notification()` without one) and so tapping one brings the page back.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.action === 'finished' ? `./?finish=${e.notification.data?.machine}` : './', self.registration.scope).href;
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find(c => c.url.startsWith(self.registration.scope));
    if (tab) {
      if (e.action === 'finished') tab.postMessage({ finish: e.notification.data?.machine });
      return tab.focus();
    }
    return self.clients.openWindow(url);
  })());
});
