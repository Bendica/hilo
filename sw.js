// Hilo · avisos. (iOS ya escribe «from Hilo» en cada notificación: el título es el contenido, no el nombre de la app.) El aviso llega vacío; el texto de cada recordatorio está guardado en este teléfono (IndexedDB), nunca en el servidor.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const idb = () => new Promise((ok, no) => { const r = indexedDB.open('hilo-rem', 1); r.onupgradeneeded = () => r.result.createObjectStore('r', { keyPath: 'id' }); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
async function takeDue() {
  try {
    const db = await idb();
    const all = await new Promise((ok, no) => { const q = db.transaction('r').objectStore('r').getAll(); q.onsuccess = () => ok(q.result || []); q.onerror = () => no(q.error); });
    const now = Date.now(), due = all.filter(x => x.at <= now + 60000 && x.at > now - 3600000 * 2);
    const old = all.filter(x => x.at <= now - 3600000 * 2);
    if (due.length || old.length) await new Promise(ok => { const t = db.transaction('r', 'readwrite'); due.concat(old).forEach(x => t.objectStore('r').delete(x.id)); t.oncomplete = ok; t.onerror = ok; });
    return due.sort((a, b) => a.at - b.at);
  } catch (e) { return []; }
}
self.addEventListener('push', e => e.waitUntil((async () => {
  const due = await takeDue();
  if (due.length) {
    await Promise.all(due.map(x => self.registration.showNotification(String(x.text || 'Tenés un aviso'), { body: 'Recordatorio', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'hilo-r-' + x.id, requireInteraction: false })));
    return;
  }
  await self.registration.showNotification('Hay algo con fecha para hoy', { body: 'Abrí la app y mirá qué toca.', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'hilo-dia' });
})()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
