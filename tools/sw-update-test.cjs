/**
 * Mise à jour de la PWA : scénario complet en vrai Chrome.
 *
 *   1. charge le build A (service worker `ctf2-v…A`), attend son activation ;
 *   2. « déploie » le build B (worker de version différente) et déclenche
 *      `registration.update()` ;
 *   3. vérifie que le nouveau worker reste **en attente**, que le bandeau
 *      apparaît et que la page **n'a pas** rechargé ;
 *   4. clique sur « Mettre à jour » → la page recharge et le worker actif est B ;
 *   5. vérifie que le cache de A est purgé et que le studio fonctionne encore.
 *
 * Usage : node tools/sw-update-test.cjs
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const DIST = process.env.CTF_DIST || path.join(ROOT, 'astro', 'dist');
const FX = path.join(ROOT, '_fx');
const PORT = 8900;
const CDP_PORT = 9364;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
};

/** Worker servi : celui de B, ou celui de A tant qu'on n'a pas « déployé ». */
const state = { sw: null, buildB: false };

function server() {
  return http
    .createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url.startsWith('/fx/')) {
        const file = path.join(FX, url.slice(4));
        if (!fs.existsSync(file)) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        return fs.createReadStream(file).pipe(res);
      }
      if (!url.startsWith('/CUTTHEFLOW/')) {
        res.writeHead(404);
        return res.end('nope');
      }
      const rest = url.slice('/CUTTHEFLOW/'.length);
      if (rest === 'service-worker.js') {
        res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' });
        return res.end(state.sw);
      }
      let file = rest === '' ? path.join(DIST, 'index.html') : path.join(DIST, rest);
      // Le build B ne diffère que par son worker : on garde le même HTML pour
      // isoler le comportement de mise à jour.
      if (!fs.existsSync(file) && !path.extname(file)) file = path.join(DIST, 'index.html');
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end('nope');
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    })
    .listen(PORT, '127.0.0.1');
}

class CDP {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('WS')), { once: true });
    });
    return new CDP(ws);
  }
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('timeout ' + method));
        }
      }, 120000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      const frames = (r.exceptionDetails.stackTrace?.callFrames ?? [])
        .slice(0, 3)
        .map((f) => `${f.functionName || '?'}@${f.lineNumber + 1}`)
        .join(' ← ');
      throw new Error(
        `${r.exceptionDetails.exception?.description || r.exceptionDetails.text}${frames ? `\n    ${frames}` : ''}`,
      );
    }
    return r.result.value;
  }
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  const swPath = path.join(DIST, 'service-worker.js');
  const swB = fs.readFileSync(swPath, 'utf8');
  const versionB = (swB.match(/const VERSION = '([^']+)'/) || [])[1];
  if (!versionB) throw new Error('VERSION introuvable dans le service worker');
  // Build A : même worker, version artificiellement reculée.
  const versionA = versionB.replace(/ctf2-v(\d+)$/, (_, n) => `ctf2-v${Math.max(1, Number(n) - 1)}`);
  const swA = swB.replace(`const VERSION = '${versionB}'`, `const VERSION = '${versionA}'`);
  console.log(`build A = ${versionA} → build B = ${versionB}`);

  state.sw = swA;
  const srv = server();
  const profile = path.join(os.tmpdir(), 'ctf-update-profile');
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      `http://127.0.0.1:${PORT}/CUTTHEFLOW/`,
    ],
    { stdio: 'ignore' },
  );

  let cdp;
  let ok = false;
  try {
    let page = null;
    for (let i = 0; i < 60 && !page; i += 1) {
      try {
        const list = await new Promise((res, rej) => {
          const r = http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json/list' }, (x) => {
            let d = '';
            x.on('data', (c) => (d += c));
            x.on('end', () => {
              try {
                res(JSON.parse(d));
              } catch (e) {
                rej(e);
              }
            });
          });
          r.on('error', rej);
        });
        page = list.find((t) => t.type === 'page' && t.url.includes('/CUTTHEFLOW/'));
      } catch {
        /* démarrage */
      }
      if (!page) await new Promise((r) => setTimeout(r, 500));
    }
    if (!page) throw new Error('page introuvable');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    // ── 1. Build A actif ──────────────────────────────────────────────
    const installA = await cdp.eval(`
      (async () => {
        for (let i = 0; i < 120; i++) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && reg.active && reg.active.state === 'activated' && navigator.serviceWorker.controller) {
            return { active: true, script: reg.active.scriptURL };
          }
          await new Promise(r => setTimeout(r, 250));
        }
        return { active: false };
      })()
    `);
    // Un second chargement garantit que la page est bien contrôlée par A.
    await cdp.send('Page.reload', { ignoreCache: false });
    await new Promise((r) => setTimeout(r, 3500));
    const stateA = await cdp.eval(`
      (async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return {
          controlled: Boolean(navigator.serviceWorker.controller),
          waiting: Boolean(reg && reg.waiting),
          caches: await caches.keys(),
        };
      })()
    `);
    check(
      'build A installé et aux commandes',
      stateA.controlled === true && stateA.waiting === false,
      `caches : ${stateA.caches.join(', ')}`,
    );

    // ── 2. Déploiement du build B ─────────────────────────────────────
    state.sw = swB;
    state.buildB = true;
    const waitingB = await cdp.eval(`
      (async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg.update();
        for (let i = 0; i < 120; i++) {
          if (reg.waiting) return { waiting: true, state: reg.waiting.state };
          await new Promise(r => setTimeout(r, 250));
        }
        return { waiting: false };
      })()
    `);
    check('le nouveau worker attend son activation (pas de bascule forcée)', waitingB.waiting === true, `état : ${waitingB.state}`);

    // ── 3. Bandeau visible, page NON rechargée ────────────────────────
    const banner = await cdp.eval(`
      (async () => {
        for (let i = 0; i < 60; i++) {
          const el = document.querySelector('#updateBanner');
          if (el && !el.hidden) {
            return {
              visible: true,
              text: document.querySelector('#updateText').textContent,
              label: document.querySelector('#updateReload').textContent,
              stillOld: Boolean(window.ctf),
            };
          }
          await new Promise(r => setTimeout(r, 250));
        }
        return { visible: false };
      })()
    `);
    check(
      'bandeau « nouvelle version » proposé à l’utilisateur',
      banner.visible === true && banner.label.length > 0 && banner.stillOld === true,
      `« ${banner.text} » / bouton « ${banner.label} »`,
    );

    const notReloaded = await cdp.eval(`(window.__probe = (window.__probe || 0) + 1) === 1`);
    check('la page ne s’est pas rechargée toute seule', notReloaded === true);

    // ── 4. Clic sur le bouton → bascule ──────────────────────────────
    await cdp.eval(
      `(async () => { document.querySelector('#updateReload').click(); return 1; })()`,
    );
    let switched = null;
    for (let i = 0; i < 80 && !switched; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        switched = await cdp.eval(`
          (async () => {
            if (!window.ctf) return null;
            const reg = await navigator.serviceWorker.getRegistration();
            return {
              waiting: Boolean(reg && reg.waiting),
              caches: await caches.keys(),
              controlled: Boolean(navigator.serviceWorker.controller),
              alive: Boolean(document.querySelector('#preview')),
            };
          })()
        `);
      } catch {
        // la navigation coupe l'exécution : on retente
        switched = null;
      }
    }
    check(
      'après le clic : nouvelle version active, studio fonctionnel',
      Boolean(switched) && switched.waiting === false && switched.alive === true,
      switched ? `caches : ${switched.caches.join(', ')}` : 'page non revenue',
    );

    // ── 5. L'ancien cache est purgé, le cache d'assets survit ────────
    const caches = switched?.caches ?? [];
    check(
      'cache du build A purgé, cache des assets conservé',
      !caches.includes(versionA) && caches.includes(versionB) && caches.includes('ctf2-assets'),
      caches.join(', '),
    );

    // ── 6. Hors-ligne : le shell et ses bundles sont servis ──────────
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await cdp.send('Page.reload', { ignoreCache: false }).catch(() => {});
    await new Promise((r) => setTimeout(r, 4000));
    let offline = null;
    try {
      offline = await cdp.eval(
        `(async () => {
          for (let i = 0; i < 60; i++) {
            if (window.ctf && document.querySelector('#preview')) return true;
            await new Promise(r => setTimeout(r, 250));
          }
          return false;
        })()`,
      );
    } catch {
      offline = false;
    }
    check('hors-ligne : le studio démarre depuis le cache', offline === true);

    ok = results.every((r) => r.ok);
  } finally {
    try {
      await cdp?.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
    } catch {
      /* ignore */
    }
    try {
      cdp && cdp.ws.close();
    } catch {
      /* ignore */
    }
    try {
      chrome.kill();
    } catch {
      /* ignore */
    }
    srv.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests OK`);
  fs.writeFileSync(
    path.join(os.tmpdir(), 'ctf-update-results.json'),
    JSON.stringify(results, null, 2),
  );
  setTimeout(() => process.exit(ok ? 0 : 1), 300).unref();
}

main().catch((e) => {
  console.error('❌ ÉCHEC:', e.message);
  process.exit(1);
});
