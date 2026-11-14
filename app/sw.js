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
// Buzón: lo nuevo que dejaron las tareas (oportunidades y correo). Se descifra aquí con la clave de este dispositivo; no se marca como leído (eso lo hace la app al abrirse).
const kdb = () => new Promise((ok, no) => { const r = indexedDB.open('hilo-keys', 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const kgo = async (k, v) => { const db = await kdb(); return new Promise((ok, no) => { const t = db.transaction('k', v === undefined ? 'readonly' : 'readwrite'), st = t.objectStore('k'); if (v === undefined) { const q = st.get(k); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); } else { st.put(v, k); t.oncomplete = () => ok(); t.onerror = () => no(t.error); } }); };
const ub = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
async function inboxNote() {
  try {
    const cfg = await kgo('cfg'), kp = await kgo('inbox');
    const auth = cfg && (cfg.auth || (cfg.code ? { code: cfg.code, device: cfg.device } : null));
    if (!cfg || !cfg.url || !auth || !kp || !kp.privateKey) return null;
    const r = await fetch(cfg.url + '/inbox/take', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(auth) });
    const d = await r.json(); const items = Array.isArray(d.items) ? d.items : [];
    const told = (await kgo('told')) || [], nw = [];
    for (const x of items) {
      if (told.includes(x.id)) continue; told.push(x.id);
      try {
        const [k, iv, c] = String(x.blob).split('.');
        const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, kp.privateKey, ub(k));
        const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
        const o = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub(iv), additionalData: new TextEncoder().encode('hilo-buzon-v1') }, key, ub(c))));
        if (o && (o.type === 'oportunidad' || o.type === 'correo') && o.title) nw.push(o);
      } catch (e) {}
    }
    await kgo('told', told.slice(-200));
    if (!nw.length) return null;
    const t = x => String(x.title).replace(/\s+/g, ' ').slice(0, 90);
    const op = nw.filter(x => x.type === 'oportunidad').length, co = nw.length - op;
    const what = [op ? op + (op === 1 ? ' oportunidad' : ' oportunidades') : '', co ? co + (co === 1 ? ' correo' : ' correos') : ''].filter(Boolean).join(' y ');
    return nw.length === 1 ? { title: t(nw[0]), body: nw[0].type === 'correo' ? 'Correo · para revisar en Hilo' : 'Oportunidad · para revisar en Hilo' } : { title: 'Nuevo en Hilo: ' + what, body: nw.slice(0, 3).map(t).join(' · ') };
  } catch (e) { return null; }
}
self.addEventListener('push', e => e.waitUntil((async () => {
  const due = await takeDue();
  if (due.length) {
    await Promise.all(due.map(x => self.registration.showNotification(String(x.text || 'Tenés un aviso'), { body: 'Recordatorio', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'hilo-r-' + x.id, data: { aviso: String(x.text || '') }, requireInteraction: false })));
    return;
  }
  const b = await inboxNote();
  if (b) { await self.registration.showNotification(b.title, { body: b.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'hilo-buzon', data: {} }); return; }
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
