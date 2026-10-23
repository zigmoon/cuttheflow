/**
 * Prouve la purge de cache PWA : on charge l'ancien service worker (r6,
 * `ctf2-v2`), puis on déploie le nouveau (`ctf2-v3`) et on recharge. Les caches
 * de l'ancienne version doivent disparaître et l'application rester utilisable.
 *
 * Usage : node tools/sw-purge-test.cjs
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const NEW_DIST = process.env.CTF_DIST || path.join(ROOT, 'astro', 'dist');
/**
 * Ancien ZIP de référence : la version immédiatement précédente. Mis à jour à
 * chaque livraison (sinon le test comparerait deux fois la même version).
 */
const OLD_ZIP = path.join(ROOT, 'CUTTHEFLOW-web-2026-10-22-r8.zip');
const PORT = 8898;
const CDP_PORT = 9362;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
};

/** Sert le nouveau build, sauf `service-worker.js` qui vient de `state.sw`. */
const state = { sw: null };

function server() {
  return http
    .createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (!url.startsWith('/CUTTHEFLOW/')) {
        res.writeHead(404);
        return res.end();
      }
      const rest = url.slice('/CUTTHEFLOW/'.length);
      if (rest === 'service-worker.js') {
        res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' });
        return res.end(state.sw);
      }
      let file = rest === '' ? path.join(NEW_DIST, 'index.html') : path.join(NEW_DIST, rest);
      if (!fs.existsSync(file) && !path.extname(file)) file = path.join(NEW_DIST, 'index.html');
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

async function main() {
  // Ancien service worker extrait du ZIP r6.
  const tmp = path.join(os.tmpdir(), 'ctf-sw-old');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Path '${OLD_ZIP}' -DestinationPath '${tmp}' -Force`],
    { stdio: 'ignore' },
  );
  const oldSw = fs.readFileSync(path.join(tmp, 'service-worker.js'), 'utf8');
  const newSw = fs.readFileSync(path.join(NEW_DIST, 'service-worker.js'), 'utf8');
  const oldVersion = (oldSw.match(/const VERSION = '([^']+)'/) || [])[1];
  const newVersion = (newSw.match(/const VERSION = '([^']+)'/) || [])[1];
  console.log(`ancien SW: ${oldVersion} — nouveau SW: ${newVersion}`);
  if (oldVersion === newVersion) throw new Error('les deux SW portent la même version');

  state.sw = oldSw;
  const srv = server();
  const profile = path.join(os.tmpdir(), 'ctf-sw-profile');
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

    const waitSw = `
      (async () => {
        for (let i = 0; i < 80; i++) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && reg.active) return true;
          await new Promise(r => setTimeout(r, 250));
        }
        return false;
      })()
    `;
    await cdp.eval(waitSw);
    // Un premier chargement contrôlé remplit le cache de l'ancienne version.
    await cdp.eval(`(async () => { location.reload(); return 1; })()`).catch(() => {});
    await new Promise((r) => setTimeout(r, 4000));
    const before = await cdp.eval(`(async () => await caches.keys())()`);
    console.log('caches après l’ancien SW :', JSON.stringify(before));

    // Déploiement du nouveau service worker.
    state.sw = newSw;
    await cdp.send('Page.enable');
    await cdp.send('Page.reload', { ignoreCache: true });
    await new Promise((r) => setTimeout(r, 1500));
    await cdp.eval(
      `(async () => { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); return 1; })()`,
    );
    await new Promise((r) => setTimeout(r, 3000));
    await cdp.send('Page.reload', { ignoreCache: true });
    await new Promise((r) => setTimeout(r, 3000));

    const after = await cdp.eval(`(async () => await caches.keys())()`);
    const alive = await cdp.eval(
      `(async () => { for (let i=0;i<60;i++){ if (window.ctf) return true; await new Promise(r=>setTimeout(r,250)); } return false; })()`,
    );
    console.log('caches après le nouveau SW :', JSON.stringify(after));

    const purged = !after.includes(oldVersion) && after.includes(newVersion);
    console.log(`${purged ? 'OK  ' : 'FAIL'} purge de ${oldVersion} : ${purged}`);
    console.log(`${alive ? 'OK  ' : 'FAIL'} application toujours fonctionnelle après la purge : ${alive}`);
    ok = purged && alive;
  } finally {
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
  setTimeout(() => process.exit(ok ? 0 : 1), 300).unref();
}

main().catch((e) => {
  console.error('❌ ÉCHEC:', e.message);
  process.exit(1);
});
