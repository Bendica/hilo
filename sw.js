// Hilo se mudó a https://hilo.bendica.workers.dev/ — este service worker se da de baja solo y ya no muestra avisos.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => { try { const s = await self.registration.pushManager.getSubscription(); if (s) await s.unsubscribe(); } catch (x) {} await self.registration.unregister(); const cs = await self.clients.matchAll({ type: 'window' }); cs.forEach(c => c.navigate(c.url)); })()));
self.addEventListener('push', e => e.waitUntil(self.registration.showNotification('Hilo se mudó', { body: 'Ábrelo en la dirección nueva.', tag: 'hilo-mudanza' })));
