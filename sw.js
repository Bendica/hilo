// Hilo · avisos. El aviso llega vacío; el texto es genérico a propósito (no sale nada tuyo del navegador).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => e.waitUntil(self.registration.showNotification('Hilo', {
  body: 'Hay algo con fecha para hoy. Abrí Hilo y mirá qué toca.',
  icon: 'icon-192.png', badge: 'icon-192.png', tag: 'hilo-dia'
})));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
