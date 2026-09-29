/*
 * 대사 출력기 - 서비스 워커
 *
 * 하는 일은 두 가지입니다.
 *   1. 앱 껍데기(html·css·js·아이콘)를 저장해 둬서, 인터넷이 없어도 창은 열리게 합니다.
 *   2. 새 버전이 올라오면 화면에 알려 줍니다.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  배포할 때마다 아래 VERSION 을 바꿔야 합니다.                │
 * │  이 파일의 내용이 달라져야 브라우저가 '새 버전'으로 봅니다.   │
 * │  (npm run release 를 돌리면 오늘 날짜로 바뀝니다)             │
 * └─────────────────────────────────────────────────────────────┘
 */
const VERSION = '2026-09-29-2';

const CACHE = `collige-${VERSION}`;

// 인터넷이 끊겼을 때도 창이 열리도록 미리 받아 두는 파일들입니다.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/characters.css',
  './css/modals.css',
  './css/worldview.css',
  './css/cursor.css',
  './css/player.css',
  './css/update.css',
  './css/ontop.css',
  './css/controls.css',
  './css/settings.css',
  './js/app.js',
  './js/config.js',
  './js/connection.js',
  './js/settings.js',
  './js/state.js',
  './js/supabase.js',
  './js/ui.js',
  './js/data/characters.js',
  './js/data/items.js',
  './js/modules/characters.js',
  './js/modules/cursor.js',
  './js/modules/customize.js',
  './js/modules/image-picker.js',
  './js/modules/items.js',
  './js/modules/modals.js',
  './js/modules/ontop.js',
  './js/modules/sfx.js',
  './js/modules/controls.js',
  './js/modules/player.js',
  './js/modules/setup.js',
  './js/modules/update.js',
  './js/modules/worldview.js',
  './sfx/pop-1.mp3',
  './sfx/pop-2.mp3',
  './sfx/pop-3.mp3',
  './sfx/pop-4.mp3',
  './sfx/pop-5.mp3',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // 하나가 없어도 설치가 통째로 실패하지 않게 따로따로 받습니다.
      Promise.all(SHELL.map(url =>
        cache.add(url).catch(error => console.warn('[sw] 못 받았습니다:', url, error.message))
      ))
    )
  );
  // 여기서 바로 넘겨받지 않습니다.
  // 화면이 '새 버전이 있어요'를 띄우고, 사람이 누를 때 넘겨받습니다.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('collige-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

/*
 * 늘 인터넷을 먼저 봅니다. 저장해 둔 것은 인터넷이 안 될 때만 씁니다.
 *
 * 반대로 하면(저장한 것 먼저) 코드를 고쳐 올려도 예전 화면이 계속 나옵니다.
 * 이 앱은 어차피 대사를 Supabase 에서 받아 오므로,
 * 저장본은 '인터넷이 끊겼을 때 창이라도 열리게' 하는 용도입니다.
 */
self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase · 구글 이미지 · jsDelivr 같은 바깥 주소는 건드리지 않습니다.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);

      /*
       * 200 일 때만 저장합니다.
       * 소리·영상은 브라우저가 조각내어(Range) 받아 오는데, 그 답은 206 이고
       * cache.put 은 206 을 거절합니다. 그대로 두면 잡히지 않은 거절이 쌓입니다.
       */
      if (fresh && fresh.status === 200) {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone()).catch(() => { /* 저장 못 해도 화면에는 지장 없습니다 */ });
      }
      return fresh;
    } catch (error) {
      const saved = await caches.match(request);
      if (saved) return saved;

      // 주소창으로 들어온 경우엔 첫 화면이라도 돌려줍니다.
      if (request.mode === 'navigate') {
        const home = await caches.match('./index.html');
        if (home) return home;
      }
      throw error;
    }
  })());
});

// 화면에서 '새로고침'을 눌렀을 때 넘겨받습니다.
self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
