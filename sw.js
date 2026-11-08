// 서비스 워커: 휴대폰 알림만 담당 (화면 저장·오프라인 캐시는 하지 않음)
// 서버는 내용 없는 알림을 보내고, 여기서 최신 문구(push_latest)를 받아 보여 줌
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let m = { title: '일산교회 청년회', body: '새 글이 올라왔어요', url: '/' };
    try {
      // 이 기기의 알림 주소를 같이 보내면, 서버가 형제/자매 쪽에 맞는 번개 소식을 골라 줌
      const sub = await self.registration.pushManager.getSubscription();
      const r = await fetch('/api/jbch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api: 'push_latest', params: { endpoint: sub ? sub.endpoint : '' } }) });
      const j = await r.json();
      if (j.status === 'ok' && j.result && j.result.title) m = j.result;
    } catch (err) { /* 문구를 못 받아도 기본 문구로 알림 */ }
    await self.registration.showNotification(m.title, {
      body: m.body, icon: '/assets/icon-192.png', badge: '/assets/icon-192.png', tag: 'ya-new', renotify: true, data: { url: m.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { await w.focus(); return w.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
