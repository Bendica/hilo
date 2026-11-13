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
// Resumen local de lo que tiene fecha (lo escribe la app en este teléfono; el servidor no lo ve).
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
async function dayNote() {
  try {
    const db = await new Promise((ok, no) => { const r = indexedDB.open('hilo-dig', 1); r.onupgradeneeded = () => r.result.createObjectStore('d', { keyPath: 'k' }); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const rec = await new Promise((ok, no) => { const q = db.transaction('d').objectStore('d').get('dig'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
    const items = (rec && rec.items) || [], today = ymd(new Date());
    const due = items.filter(x => x.d === today), late = items.filter(x => x.d < today), list = due.length ? due : late;
    if (!list.length) return null;
    if (list.length === 1) return { title: list[0].t, body: due.length ? 'Vence hoy' : 'Vencido', open: list[0].id };
    return { title: list.length + (due.length ? ' cosas con fecha para hoy' : ' cosas vencidas'), body: list.slice(0, 3).map(x => x.t).join(' · '), open: list[0].id };
  } catch (e) { return null; }
}
self.addEventListener('push', e => e.waitUntil((async () => {
  const due = await takeDue();
  if (due.length) {
    await Promise.all(due.map(x => self.registration.showNotification(String(x.text || 'Tenés un aviso'), { body: 'Recordatorio', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'hilo-r-' + x.id, data: { aviso: String(x.text || '') }, requireInteraction: false })));
    return;
  }
  const n = await dayNote();
  await self.registration.showNotification(n ? n.title : 'Hay algo con fecha para hoy', { body: n ? n.body : 'Abrí la app y mirá qué toca.', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'hilo-dia', data: n ? { open: n.open } : {} });
})()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {}, msg = d.open ? { abrir: d.open } : d.aviso ? { aviso: d.aviso } : null;
  const q = d.open ? '?abrir=' + encodeURIComponent(d.open) : d.aviso ? '?aviso=' + encodeURIComponent(d.aviso) : '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) { if (msg) c.postMessage(msg); return c.focus(); }
    return self.clients.openWindow('./' + q);
  }));
});
