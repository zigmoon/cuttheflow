// CUT THE FLOW - Service Worker
// App-shell cache for installability, revisit speed, and offline fallback.

const CACHE_NAME = 'cuttheflow-shell-v3.10.1-r3';
const FONT_ASSETS = [
  './fonts/8vIH7w4qzmVxm25L9Hz_.woff2',
  './fonts/8vIH7w4qzmVxm2BL9A.woff2',
  './fonts/8vIH7w4qzmVxm2NL9Hz_.woff2',
  './fonts/-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2',
  './fonts/-F63fjptAgt5VM-kVkqdyU8n1iAq129k.woff2',
  './fonts/-F63fjptAgt5VM-kVkqdyU8n1iEq129k.woff2',
  './fonts/-F63fjptAgt5VM-kVkqdyU8n1iIq129k.woff2',
  './fonts/-F63fjptAgt5VM-kVkqdyU8n1isq129k.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3pQPwl1FgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3pQPwl5FgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3pQPwl9FgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3pQPwlBFgg.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3pQPwlRFgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3twJwl1FgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3twJwl5FgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3twJwl9FgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgg.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3twJwlRFgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3vAOwl1FgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3vAOwl5FgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3vAOwl9FgtIU.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3vAOwlBFgg.woff2',
  './fonts/-F6qfjptAgt5VM-kVkqdyU8n3vAOwlRFgtIU.woff2',
  './fonts/i7dMIFZifjKcF5UAWdDRaPpZUFqaHjyV.woff2',
  './fonts/i7dMIFZifjKcF5UAWdDRaPpZUFuaHjyV.woff2',
  './fonts/i7dMIFZifjKcF5UAWdDRaPpZUFWaHg.woff2',
  './fonts/i7dPIFZifjKcF5UAWdDRYE58RWq7.woff2',
  './fonts/i7dPIFZifjKcF5UAWdDRYE98RWq7.woff2',
  './fonts/i7dPIFZifjKcF5UAWdDRYEF8RQ.woff2',
  './fonts/QGYvz_MVcBeNP4NJtEtq.woff2',
  './fonts/QGYvz_MVcBeNP4NJuktqQ4E.woff2',
  './fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx3cwhsk.woff2',
  './fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx7cwhsk.woff2',
  './fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2',
  './fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxPcwhsk.woff2',
  './fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxTcwhsk.woff2',
  './fonts/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx_cwhsk.woff2',
  './fonts/V8mDoQDjQSkFtoMM3T6r8E7mPb54C-s0.woff2',
  './fonts/V8mDoQDjQSkFtoMM3T6r8E7mPb94C-s0.woff2',
  './fonts/V8mDoQDjQSkFtoMM3T6r8E7mPbF4Cw.woff2',
  './fonts/yMJRMIlzdpvBhQQL_Qq7dy0.woff2'
];

// ⚠️ TOUTE modification de ces URL doit aussi être répercutée dans index.html.
// Le nom du cache est versionné (voir CACHE_NAME) : un déploiement doit changer
// les deux, sinon l'ancien shell continue d'être servi.
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css?v=61dcf7ada5',
  './css/fonts-core-local.css?v=995150540d',
  './css/fonts-editor-local.css?v=2cc7c6dded',
  './js/export-safeguards.js?v=95a781417a',
  './js/frame-source.js?v=54bb663da8',
  './js/canvas-export.js?v=0696cc5ed6',
  './js/webcodecs-export.js?v=364d6657bc',
  './js/webm-webcodecs-export.js?v=a4a0196514',
  './js/mp3-export.js?v=0fa41e08b5',
  './js/unified-export.js?v=b9094b677b',
  './js/i18n.js?v=574e1152c7',
  './js/app.js?v=b0dc5950b8',
  './js/ctf-advanced.js?v=e9edeefad6',
  './vendor/jszip.min.js?v=f12f367798',
  './vendor/mp4box.all.min.js?v=cd54ad2385',
  './vendor/lamejs.min.js?v=53b4daef2f',
  './manifest.json',
  './img/CUT_THE_FLOW_b.svg?v=706967781b',
  './img/icon-192.png?v=cfec14d144',
  './img/icon-512.png?v=e5498cb51a',
  './img/icon-512-maskable.png?v=d951de7d28',
  './img/apple-touch-icon.png?v=19af1f09c6',
  './logo_cut_the_flow_20_blanc.png?v=88b990cbb6',
  ...FONT_ASSETS
];

const APP_SHELL_PATHS = new Set(
  APP_SHELL.map((asset) => new URL(asset, self.location.href).pathname)
);

function isCacheableResponse(response) {
  return !!response && (
    response.status === 200 ||
    response.type === 'basic' ||
    response.type === 'default' ||
    response.type === 'opaque'
  );
}

function getCacheKey(requestUrl) {
  return new URL(requestUrl.href).toString();
}

async function writeToCache(requestUrl, response) {
  if (!isCacheableResponse(response)) {
    return response;
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.put(getCacheKey(requestUrl), response.clone());
  return response;
}

async function readFromCache(requestUrl) {
  return caches.match(getCacheKey(requestUrl));
}

async function fetchAndCache(request, requestUrl) {
  const response = await fetch(request);
  return writeToCache(requestUrl, response);
}

async function precacheAppShell() {
  // 🐛 CORRECTIF (2026-09-10) — un `throw` sur UN seul asset en échec faisait
  // échouer tout `install()`, donc le service worker ne s'activait JAMAIS et
  // l'app perdait tout le bénéfice hors-ligne. On met en cache ce qu'on peut et
  // on signale les échecs : l'app reste installable même si une police manque.
  const results = await Promise.allSettled(
    APP_SHELL.map(async (asset) => {
      const assetUrl = new URL(asset, self.location.href);
      const response = await fetch(assetUrl, { cache: 'no-cache' });
      if (!isCacheableResponse(response)) {
        throw new Error(`HTTP ${response.status} pour ${assetUrl.pathname}`);
      }
      await writeToCache(assetUrl, response);
    })
  );
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? `${APP_SHELL[i]} → ${r.reason && r.reason.message}` : null))
    .filter(Boolean);
  if (failed.length) {
    console.warn(`⚠️ Service worker : ${failed.length} asset(s) non mis en cache :\n` + failed.join('\n'));
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map((cacheName) => {
        if (cacheName !== CACHE_NAME) {
          return caches.delete(cacheName);
        }
        return Promise.resolve();
      })
    );

    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  const isNavigate = event.request.mode === 'navigate';
  const isShellAsset = APP_SHELL_PATHS.has(requestUrl.pathname);

  event.respondWith((async () => {
    if (isNavigate) {
      try {
        const preloadResponse = await event.preloadResponse;
        if (preloadResponse) {
          event.waitUntil(writeToCache(requestUrl, preloadResponse.clone()));
          return preloadResponse;
        }
        return await fetchAndCache(event.request, requestUrl);
      } catch (error) {
        const offlineShell = await readFromCache(new URL('./index.html', self.location.href));
        if (offlineShell) {
          return offlineShell;
        }
        return Response.error();
      }
    }

    const cachedResponse = await readFromCache(requestUrl);
    if (cachedResponse) {
      if (isShellAsset) {
        event.waitUntil(fetchAndCache(event.request, requestUrl).catch(() => null));
      }
      return cachedResponse;
    }

    try {
      return await fetchAndCache(event.request, requestUrl);
    } catch (error) {
      if (isShellAsset) {
        const fallback = await readFromCache(requestUrl);
        if (fallback) {
          return fallback;
        }
      }
      return Response.error();
    }
  })());
});
