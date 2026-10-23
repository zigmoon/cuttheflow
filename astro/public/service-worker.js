/*
 * CUT THE FLOW — service worker.
 *
 * Objectifs, dans cet ordre :
 *
 * 1. **Ne jamais servir une version bancale.** L'ancien worker appelait
 *    `skipWaiting()` à l'installation : un onglet déjà ouvert se retrouvait avec
 *    son HTML d'origine et des fichiers dont le cache venait d'être purgé. Ici
 *    la nouvelle version **attend** que la page demande l'activation ; c'est
 *    `sw-register.ts` qui affiche « nouvelle version disponible » et déclenche
 *    le basculement au clic.
 * 2. **Hors-ligne réel dès l'installation.** Le shell précaché inclut les
 *    fichiers hachés (`_astro/…`) référencés par `index.html`, pas seulement la
 *    page : sans eux le studio s'ouvrait hors-ligne sur un écran vide.
 * 3. **Ne pas gaspiller le quota de stockage.** Les fichiers de `_astro/`,
 *    `vendor/`, `img/` portent un hash de contenu : ils sont donc dans un cache
 *    **non versionné** qui survit aux mises à jour, plafonné en nombre
 *    d'entrées. Seul le cache du shell est purgé à chaque `VERSION`.
 *
 * Le studio est publié dans un sous-dossier (`/CUTTHEFLOW/`) : toutes les URL
 * sont résolues depuis `self.registration.scope`, jamais depuis la racine.
 */

const VERSION = 'ctf2-v9';

/** Cache du shell : purgé à chaque nouvelle version. */
const SHELL_CACHE = VERSION;
/** Cache des fichiers hachés : conservé entre versions, plafonné. */
const ASSET_CACHE = 'ctf2-assets';
const ASSET_LIMIT = 260;

const SHELL = ['./', './index.html', './manifest.webmanifest'];
const IMMUTABLE = /(?:^|\/)(?:_astro|vendor|img|fonts)\//;

const scopeUrl = new URL(self.registration.scope);
const shellEntry = new URL('./index.html', scopeUrl).toString();

/** URL absolues des fichiers hachés cités par le `index.html` courant. */
function assetsInHtml(html, base) {
  const found = new Set();
  const pattern = /(?:src|href)="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html))) {
    let url;
    try {
      url = new URL(match[1], base);
    } catch {
      continue;
    }
    if (url.origin !== self.location.origin) continue;
    if (!url.pathname.startsWith(scopeUrl.pathname)) continue;
    if (!IMMUTABLE.test(url.pathname)) continue;
    found.add(url.toString());
  }
  return [...found];
}

async function precache() {
  const shellCache = await caches.open(SHELL_CACHE);
  const shells = await Promise.allSettled(
    SHELL.map(async (path) => {
      const url = new URL(path, scopeUrl).toString();
      const response = await fetch(url, { cache: 'no-cache' });
      if (response && response.ok) await shellCache.put(url, response.clone());
      return { url, response };
    }),
  );

  // Les fichiers hachés de CE build : sans eux, le hors-ligne n'affiche rien.
  const page = shells.find(
    (entry) => entry.status === 'fulfilled' && entry.value.url === shellEntry,
  );
  const html =
    page && page.status === 'fulfilled' && page.value.response.ok
      ? await page.value.response.clone().text()
      : '';
  if (!html) return;

  const assetCache = await caches.open(ASSET_CACHE);
  await Promise.allSettled(
    assetsInHtml(html, shellEntry).map(async (url) => {
      if (await assetCache.match(url)) return;
      const response = await fetch(url, { cache: 'no-cache' });
      if (response && response.ok) await assetCache.put(url, response);
    }),
  );
}

/** Plafonne le cache d'assets : les plus anciennes entrées partent d'abord. */
async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  if (keys.length <= ASSET_LIMIT) return;
  await Promise.all(keys.slice(0, keys.length - ASSET_LIMIT).map((key) => cache.delete(key)));
}

self.addEventListener('install', (event) => {
  // Pas de `skipWaiting()` : la page décide quand basculer, sinon un onglet
  // déjà ouvert se retrouve à cheval entre deux builds.
  event.waitUntil(precache().catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => {
          if (name === SHELL_CACHE || name === ASSET_CACHE) return null;
          // Les anciennes versions du studio, et rien d'autre : ce worker ne
          // doit pas effacer le cache d'une autre application du domaine.
          return name.startsWith('ctf2-') ? caches.delete(name) : null;
        }),
      );
      await trimAssets();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }
  if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request, response.clone());
    void trimAssets();
  }
  return response;
}

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      void cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    // Dernier recours : le shell précaché, même si l'URL demandée a changé.
    const shell = await cache.match(shellEntry);
    if (shell) return shell;
    const assets = await caches.open(ASSET_CACHE);
    return (await assets.match(request)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Ne jamais interférer avec une autre application du même domaine.
  if (!url.pathname.startsWith(scopeUrl.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(cacheFirst(request).catch(() => Response.error()));
  }
});
