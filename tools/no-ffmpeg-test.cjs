/**
 * Cas « serveur présent, ffmpeg absent ».
 *
 * C'est la situation d'un utilisateur qui télécharge le binaire sans installer
 * ffmpeg : le studio doit s'ouvrir en mode navigateur, importer et exporter,
 * sans erreur bloquante. Avant, `serve` refusait de démarrer.
 *
 * Usage : node tools/no-ffmpeg-test.cjs
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'packages', 'CUTTHEFLOW-0.7.0-windows-x86_64.zip');
const FX = path.join(ROOT, '_fx');
const CDP_PORT = 9366;
const APP_PORT = 7431;
const RECV_PORT = 8912;

function receiver() {
  const out = path.join(os.tmpdir(), 'ctf-noffmpeg-out');
  fs.mkdirSync(out, { recursive: true });
  return http
    .createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
      const name = path.basename(req.headers['x-filename'] || 'f.bin');
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => {
        fs.writeFileSync(path.join(out, name), Buffer.concat(chunks));
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
        res.end('ok');
      });
    })
    .listen(RECV_PORT, '127.0.0.1');
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
      }, 300000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
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
  // On extrait l'archive utilisateur et on lance le VRAI binaire, avec un PATH
  // qui ne contient aucun ffmpeg : conditions réelles d'un premier essai.
  const dir = path.join(os.tmpdir(), 'ctf-noffmpeg-run');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const { execFileSync } = require('child_process');
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -Path '${BIN}' -DestinationPath '${dir}' -Force`,
  ]);

  const recv = receiver();
  const psi = new (require('child_process').spawn)(
    path.join(dir, 'cuttheflow.exe'),
    ['serve', '--port', String(APP_PORT), '--no-open'],
    {
      cwd: dir,
      env: {
        SystemRoot: 'C:\\Windows',
        PATH: 'C:\\Windows\\System32;C:\\Windows',
        LOCALAPPDATA: path.join(dir, 'data'),
      },
      stdio: 'ignore',
    },
  );

  const profile = path.join(os.tmpdir(), 'ctf-noffmpeg-profile');
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1600,1000',
      `http://127.0.0.1:${APP_PORT}/`,
    ],
    { stdio: 'ignore' },
  );

  let cdp;
  try {
    // Le serveur doit répondre SANS ffmpeg (c'était l'objet du correctif).
    let health = null;
    for (let i = 0; i < 40 && !health; i += 1) {
      try {
        health = await new Promise((res, rej) => {
          const r = http.get(`http://127.0.0.1:${APP_PORT}/api/health`, (x) => {
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
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    check(
      'le serveur démarre sans ffmpeg et annonce son état',
      Boolean(health) && health.engine === false && typeof health.reason === 'string' && health.reason.length > 10,
      health ? `engine=${health.engine}` : 'aucune réponse',
    );

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
        page = list.find((t) => t.type === 'page' && t.url.includes(String(APP_PORT)));
      } catch {
        /* démarrage */
      }
      if (!page) await new Promise((r) => setTimeout(r, 500));
    }
    if (!page) throw new Error('page introuvable');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    const state = await cdp.eval(`
      (async () => {
        for (let i = 0; i < 120; i++) {
          if (window.ctf && window.ctf.engineSettled) break;
          await new Promise(r => setTimeout(r, 250));
        }
        const ctf = window.ctf;
        const badge = document.querySelector('#engineBadge');
        const dot = badge.querySelector('.engine-dot');
        return {
          mode: ctf.mode,
          engineOk: ctf.engineOk,
          badgeState: badge.dataset.state,
          badgeColor: getComputedStyle(dot).backgroundColor,
          badge: document.querySelector('#engineLabel')?.textContent ?? '',
          toasts: [...document.querySelectorAll('.toast')].map(t => ({
            text: t.textContent.slice(0, 120), kind: t.dataset.kind ?? t.className,
          })),
        };
      })()
    `);
    check(
      'l’interface bascule en mode navigateur',
      state.mode === 'local' && state.engineOk === false,
      `mode=${state.mode}, pastille « ${state.badge} »`,
    );
    // Même situation qu'en ligne : serveur sans ffmpeg ≠ panne. La pastille doit
    // rester informative, jamais rouge « offline ».
    check(
      'pastille informative, pas « offline » rouge',
      state.badgeState === 'browser' && state.badge !== 'offline',
      `état=${state.badgeState}, couleur=${state.badgeColor}, libellé « ${state.badge} »`,
    );
    const friendly = state.toasts.find((x) => /ffmpeg/i.test(x.text));
    check(
      'message informatif (pas une erreur) expliquant ffmpeg',
      Boolean(friendly) && !/error/i.test(friendly.kind),
      friendly ? `« ${friendly.text} » (${friendly.kind})` : 'aucun message',
    );

    // Export navigateur : on construit un petit projet (forme) et on encode.
    const exported = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        ctf.project.tracks.forEach(t => { t.clips.length = 0; });
        ctf.timeUs = 0;
        ctf.addShape('rect');
        const track = ctf.project.tracks.find(t => t.clips.length);
        const clip = track.clips[0];
        clip.duration_us = 500_000;
        clip.afterEdit;
        ctf.selectClip(clip.id);
        ctf.afterEdit();
        ctf.openExport();
        document.querySelector('#exportResolution').value = '1280x720';
        document.querySelector('#exportFps').value = '30';
        const f = document.querySelector('#exportFormat');
        f.value = 'mp4';
        f.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
        const diag = {
          encoder: typeof VideoEncoder,
          secure: window.isSecureContext,
          blocked: document.querySelector('#startExportBtn').disabled,
          notice: (document.querySelector('#exportEncoderNotice').textContent || '').slice(0, 160),
          stage: (document.querySelector('#exportStage').textContent || '').slice(0, 80),
        };
        window.__errors = [];
        window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
        window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejet: ' + String(e.reason)));
        document.querySelector('#startExportBtn').click();
        // Le clic synthétique peut être ignoré selon l'état du dialogue : on
        // appelle la méthode publique du studio, comme le fait le bouton.
        await new Promise(r => setTimeout(r, 300));
        if ((document.querySelector('#exportStage').textContent || '') === diag.stage) {
          await ctf.startExport();
        }
        const stages = [];
        for (let i = 0; i < 400; i++) {
          const link = document.querySelector('#exportResult a');
          if (link) {
            const buf = await (await fetch(link.href)).arrayBuffer();
            await fetch('http://127.0.0.1:${RECV_PORT}/up', {
              method: 'POST', headers: { 'x-filename': 'noffmpeg-export.mp4' }, body: buf,
            });
            return { size: buf.byteLength, diag };
          }
          if (i % 10 === 0) {
            stages.push(
              (document.querySelector('#exportStage').textContent || '') +
                ' ' + (document.querySelector('#exportPercent').textContent || ''),
            );
          }
          const err = document.querySelector('#exportError');
          if (err && !err.hidden && err.textContent) return { error: err.textContent, diag, stages };
          await new Promise(r => setTimeout(r, 200));
        }
        return { error: 'timeout', diag, stages, errors: window.__errors.slice(0, 5) };
      })()
    `);
    check(
      'export vidéo possible sans ffmpeg (WebCodecs)',
      !exported.error && exported.size > 3000,
      exported.error
        ? `${exported.error} | ${JSON.stringify(exported.diag)} | étapes ${JSON.stringify(exported.stages)} | erreurs ${JSON.stringify(exported.errors || [])}`
        : `${(exported.size / 1024).toFixed(0)} Ko`,
    );
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
    try {
      psi.kill();
    } catch {
      /* ignore */
    }
    recv.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests OK`);
  setTimeout(() => process.exit(failed.length ? 1 : 0), 300).unref();
}

main().catch((e) => {
  console.error('❌ ÉCHEC:', e.message);
  process.exit(1);
});
