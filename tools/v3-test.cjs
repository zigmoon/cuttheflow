/**
 * Tests fonctionnels v3 (keyframes, vitesse, masques, formes d'onde) dans un
 * vrai Chrome, sur le build statique servi sous /CUTTHEFLOW/.
 *
 * Usage : node tools/v3-test.cjs
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DIST = process.env.CTF_DIST || path.resolve(__dirname, '..', 'astro', 'dist');
const FX = path.resolve(__dirname, '..', '_fx');
const OUT = path.join(os.tmpdir(), 'ctfv3-out');
const PORT = 8897;
const CDP_PORT = 9361;
const RECV_PORT = 8907;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
};

function staticServer() {
  return http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = null;
    if (url.startsWith('/fx/')) file = path.join(FX, url.slice(4));
    else if (url.startsWith('/CUTTHEFLOW/')) {
      const rest = url.slice('/CUTTHEFLOW/'.length);
      file = rest === '' ? path.join(DIST, 'index.html') : path.join(DIST, rest);
      if (file && !fs.existsSync(file) && !path.extname(file)) file = path.join(DIST, 'index.html');
    }
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('nope');
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, '127.0.0.1');
}

function receiver() {
  fs.mkdirSync(OUT, { recursive: true });
  return http.createServer((req, res) => {
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
      fs.writeFileSync(path.join(OUT, name), Buffer.concat(chunks));
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
      res.end('ok');
    });
  }).listen(RECV_PORT, '127.0.0.1');
}

class CDP {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('WS fail')), { once: true });
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
      }, 600000);
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
        .slice(0, 4)
        .map((f) => `${f.functionName || '(anonyme)'} @ ${f.url.split('/').pop()}:${f.lineNumber + 1}`)
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
  const server = staticServer();
  const recv = receiver();
  const profile = path.join(os.tmpdir(), 'ctfv3-profile');
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
      `http://127.0.0.1:${PORT}/CUTTHEFLOW/`,
    ],
    { stdio: 'ignore' },
  );

  let cdp;
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
        /* chrome démarre */
      }
      if (!page) await new Promise((r) => setTimeout(r, 500));
    }
    if (!page) throw new Error('page introuvable');
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    console.log('✅ ' + (await cdp.eval('navigator.userAgent')).match(/Chrome\/[\d.]+/)[0]);

    const booted = await cdp.eval(
      `(async()=>{for(let i=0;i<120;i++){if(window.ctf&&document.querySelector('.clip'))return 1;if(window.ctf&&i>20)return 2;await new Promise(r=>setTimeout(r,250));}return 0;})()`,
    );
    check('démarrage du studio', booted > 0, `état ${booted}`);

    // ── Import ────────────────────────────────────────────────────────
    const imported = await cdp.eval(`
      (async () => {
        const b = await (await fetch('/fx/test.mp4')).arrayBuffer();
        await window.ctf.importFiles([new File([b], 'test.mp4', { type: 'video/mp4' })]);
        for (let i = 0; i < 40 && !window.ctf.project.media.length; i++) await new Promise(r => setTimeout(r, 250));
        const media = window.ctf.project.media[0];
        // L'import pose déjà un clip : on repart d'une timeline propre pour que
        // le test ne mesure qu'un seul clip.
        window.ctf.project.tracks.forEach(t => { t.clips.length = 0; });
        const track = window.ctf.project.tracks.find(t => t.kind === 'video');
        window.ctf.addMediaToTrack(media.id, track.id, 0);
        window.ctf.afterEdit();
        await new Promise(r => setTimeout(r, 300));
        const clip = window.ctf.project.tracks[0].clips[0];
        window.ctf.selectClip(clip.id);
        return { id: media.id, name: media.name, dur: media.duration_us, clip: clip.id, has_audio: media.has_audio, clips: window.ctf.project.tracks.reduce((n, t) => n + t.clips.length, 0) };
      })()
    `);
    check('import vidéo + pose sur la piste', Boolean(imported && imported.clip) && imported.clips === 1, `${imported?.name} ${Math.round((imported?.dur || 0) / 1000)} ms, ${imported?.clips} clip`);

    // ── Forme d'onde ──────────────────────────────────────────────────
    const wave = await cdp.eval(`
      (async () => {
        for (let i = 0; i < 60; i++) {
          const c = document.querySelector('canvas[data-wave]');
          if (c && c.dataset.painted) {
            const ctx = c.getContext('2d');
            const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
            let lit = 0;
            for (let p = 3; p < pixels.length; p += 4) if (pixels[p] > 8) lit++;
            return { painted: true, lit };
          }
          await new Promise(r => setTimeout(r, 250));
        }
        return { painted: false, lit: 0 };
      })()
    `);
    check('forme d’onde audio dessinée', wave.painted && wave.lit > 200, `${wave.lit} px allumés`);

    // ── Keyframes : opacité 100% → 0% ─────────────────────────────────
    const kf = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const clip = ctf.project.tracks[0].clips[0];
        ctf.selectClip(clip.id);
        ctf.timeUs = 0;
        ctf.addKeyframe('opacity');
        ctf.timeUs = 1_000_000;
        // la valeur courante est 1 : on force la seconde clé à 0
        ctf.addKeyframe('opacity');
        ctf.project.tracks[0].clips[0].keyframes.find(k => k.time_us === 1_000_000).value = 0;
        ctf.afterEdit();
        const c = ctf.project.tracks[0].clips[0];
        return {
          count: c.keyframes.length,
          rows: document.querySelectorAll('.kf-key').length,
          badge: Boolean(document.querySelector('.clip-badge.kf')),
        };
      })()
    `);
    check('keyframes posées (2 clés, UI + badge)', kf.count === 2 && kf.rows >= 2 && kf.badge, `${kf.count} clés, ${kf.rows} lignes`);

    // Le rendu doit assombrir l'image entre 0 s et 1 s.
    const kfRender = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const canvas = document.querySelector('#preview');
        const sample = async (us) => {
          ctf.setTime(us);
          // La vidéo doit avoir fini de se positionner avant la composition.
          for (let i = 0; i < 40; i++) {
            ctf.preview.draw();
            const ctx = canvas.getContext('2d');
            const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let sum = 0, n = 0;
            for (let p = 0; p < d.length; p += 4 * 97) { sum += d[p] + d[p + 1] + d[p + 2]; n++; }
            if (sum > 0) return sum / n / 3;
            await new Promise(r => setTimeout(r, 150));
          }
          return 0;
        };
        const at0 = await sample(20_000);
        const mid = await sample(500_000);
        const after = await sample(1_500_000);
        return { at0: Math.round(at0), mid: Math.round(mid), after: Math.round(after) };
      })()
    `);
    check(
      'keyframes rendues (fondu 100 % → 0 %)',
      kfRender.at0 > kfRender.mid + 15 && kfRender.mid > kfRender.after + 10,
      `t0=${kfRender.at0} t0.5=${kfRender.mid} t1.5=${kfRender.after}`,
    );

    // ── Vitesse ───────────────────────────────────────────────────────
    const speed = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const clip = ctf.project.tracks[0].clips[0];
        clip.keyframes = [];
        ctf.afterEdit();
        ctf.selectClip(clip.id);
        const before = clip.duration_us;
        const el = document.querySelector('[data-prop="speed"]');
        el.value = '200';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 200));
        const after = ctf.project.tracks[0].clips[0].duration_us;
        return { before, after, speed: ctf.project.tracks[0].clips[0].speed, badge: Boolean(document.querySelector('.clip-badge.speed')) };
      })()
    `);
    check(
      'vitesse 2× : durée divisée par deux (source conservée)',
      Math.abs(speed.after - speed.before / 2) < 60_000 && speed.speed === 2 && speed.badge,
      `${(speed.before / 1e6).toFixed(2)} s → ${(speed.after / 1e6).toFixed(2)} s`,
    );

    // ── Masque ────────────────────────────────────────────────────────
    const mask = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const clip = ctf.project.tracks[0].clips[0];
        ctf.setTime(400_000);
        ctf.selectClip(clip.id);
        const open = () => { const b = document.querySelector('[data-action="open-export"]'); if (b) b.click(); };
        const sample = async () => {
          for (let i = 0; i < 40; i++) {
            ctf.preview.draw();
            const canvas = document.querySelector('#preview');
            const ctx = canvas.getContext('2d');
            const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let total = 0;
            for (let p = 0; p < d.length; p += 4 * 97) total += d[p];
            if (total > 0) {
              const px = (x, y) => { const i = (y * canvas.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
              return {
                corner: px(4, 4).reduce((a, b) => a + b, 0),
                centre: px(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)).reduce((a, b) => a + b, 0),
              };
            }
            await new Promise(r => setTimeout(r, 150));
          }
          return { corner: 0, centre: 0 };
        };
        const before = await sample();
        const box = document.querySelector('[data-prop="maskOn"]');
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        const after = await sample();
        return { before, after, has: Boolean(ctf.project.tracks[0].clips[0].mask) };
      })()
    `);
    check(
      'masque : les coins sortent, le centre reste',
      mask.has && mask.after.corner < 40 && mask.after.centre > 100,
      `coin ${mask.before.corner} → ${mask.after.corner}, centre ${mask.before.centre} → ${mask.after.centre}`,
    );

    // ── Export MP4 avec les 3 fonctions actives ───────────────────────
    const exportMp4 = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const clip = ctf.project.tracks[0].clips[0];
        clip.keyframes = [
          { prop: 'scale', time_us: 0, value: 1, easing: 'linear' },
          { prop: 'scale', time_us: 800_000, value: 1.6, easing: 'linear' },
        ];
        clip.speed = 2;
        clip.mask = { kind: 'ellipse', x: 0.5, y: 0.5, width: 0.8, height: 0.8, feather: 0.1, invert: false };
        ctf.afterEdit();
        ctf.openExport();
        document.querySelector('#exportResolution').value = '1280x720';
        document.querySelector('#exportFps').value = '30';
        const f = document.querySelector('#exportFormat');
        f.value = 'mp4';
        f.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
        const err0 = document.querySelector('#exportEncoderNotice').textContent;
        const state = { clips: ctf.project.tracks[0].clips.map(c => ({ dur: c.duration_us, speed: c.speed, start: c.start_us })) };
        document.querySelector('#startExportBtn').click();
        let blob = null;
        for (let i = 0; i < 400; i++) {
          const link = document.querySelector('#exportResult a');
          if (link) { blob = link.href; break; }
          const err = document.querySelector('#exportError');
          if (err && !err.hidden && err.textContent) return JSON.stringify({ err: err.textContent });
          await new Promise(r => setTimeout(r, 250));
        }
        if (!blob) return JSON.stringify({ err: 'pas de résultat', state });
        const buf = await (await fetch(blob)).arrayBuffer();
        await fetch('http://127.0.0.1:${RECV_PORT}/up', {
          method: 'POST', headers: { 'x-filename': 'v3-key-speed-mask.mp4' }, body: buf,
        });
        return JSON.stringify({ size: buf.byteLength, notice: err0, state, end: ctf.project.tracks[0].clips.reduce((m, c) => Math.max(m, c.start_us + c.duration_us), 0) });
      })()
    `);
    const mp4 = JSON.parse(exportMp4);
    console.log('    état export :', JSON.stringify(mp4.state), 'fin timeline', mp4.end);
    check('export MP4 (keyframes + vitesse + masque)', !mp4.err && mp4.size > 20000, mp4.err || `${(mp4.size / 1024).toFixed(0)} Ko`);

    // ── Export MP3 (audio à 2×) ───────────────────────────────────────
    const exportMp3 = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        ctf.openExport();
        const f = document.querySelector('#exportFormat');
        f.value = 'mp3';
        f.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
        document.querySelector('#startExportBtn').click();
        for (let i = 0; i < 400; i++) {
          const link = document.querySelector('#exportResult a');
          if (link) {
            const buf = await (await fetch(link.href)).arrayBuffer();
            await fetch('http://127.0.0.1:${RECV_PORT}/up', {
              method: 'POST', headers: { 'x-filename': 'v3-audio-2x.mp3' }, body: buf,
            });
            return JSON.stringify({ size: buf.byteLength });
          }
          const err = document.querySelector('#exportError');
          if (err && !err.hidden && err.textContent) return JSON.stringify({ err: err.textContent });
          await new Promise(r => setTimeout(r, 250));
        }
        return JSON.stringify({ err: 'timeout' });
      })()
    `);
    const mp3 = JSON.parse(exportMp3);
    check('export MP3 (mixage à 2×)', !mp3.err && mp3.size > 8000, mp3.err || `${(mp3.size / 1024).toFixed(0)} Ko`);

    // ── Undo / redo sur les nouvelles propriétés ──────────────────────
    const undo = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const clip = ctf.project.tracks[0].clips[0];
        const before = JSON.stringify({ speed: clip.speed, mask: clip.mask, kf: clip.keyframes.length });
        ctf.undo();
        await new Promise(r => setTimeout(r, 200));
        const mid = ctf.project.tracks[0].clips[0];
        const afterUndo = JSON.stringify({ speed: mid.speed, mask: mid.mask, kf: (mid.keyframes || []).length });
        ctf.redo();
        await new Promise(r => setTimeout(r, 200));
        const back = ctf.project.tracks[0].clips[0];
        return { before, afterUndo, afterRedo: JSON.stringify({ speed: back.speed, mask: back.mask, kf: (back.keyframes || []).length }) };
      })()
    `);
    check('undo/redo couvre vitesse + masque + keyframes', undo.before !== undo.afterUndo && undo.afterRedo === undo.before, `${undo.afterUndo.slice(0, 46)}…`);

    // ── Sauvegarde / rechargement du projet ───────────────────────────
    const roundtrip = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const json = JSON.stringify(ctf.project);
        const norm = window.__ctfNormalize ? window.__ctfNormalize(json) : null;
        const parsed = JSON.parse(json);
        const clip = parsed.tracks[0].clips[0];
        const reloaded = await new Promise((res) => {
          const input = document.querySelector('#projectInput');
          if (!input) return res(null);
          res('input-present');
        });
        return { hasInput: reloaded, speed: clip.speed, mask: Boolean(clip.mask), kf: clip.keyframes.length };
      })()
    `);
    check(
      'projet sérialisé avec vitesse / masque / keyframes',
      roundtrip.speed === 2 && roundtrip.mask === true && roundtrip.kf === 2,
      `speed=${roundtrip.speed} mask=${roundtrip.mask} kf=${roundtrip.kf}`,
    );

    // ── Keyframes dans l'export : une forme blanche qui rétrécit ──────
    const exportKf = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        ctf.project.tracks.forEach(t => { t.clips.length = 0; });
        ctf.timeUs = 0;
        ctf.addShape('rect');
        const track = ctf.project.tracks.find(t => t.clips.length);
        const clip = track.clips[0];
        clip.duration_us = 500_000;
        clip.shape = { kind: 'rect', color: '#F0F0F2', width: 0.42, height: 0.42, radius: 0 };
        clip.keyframes = [
          { prop: 'scale', time_us: 0, value: 1, easing: 'linear' },
          { prop: 'scale', time_us: 400_000, value: 0.3, easing: 'linear' },
        ];
        ctf.selectClip(clip.id);
        ctf.afterEdit();
        ctf.openExport();
        document.querySelector('#exportResolution').value = '1280x720';
        document.querySelector('#exportFps').value = '30';
        const f = document.querySelector('#exportFormat');
        f.value = 'mp4';
        f.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
        document.querySelector('#startExportBtn').click();
        for (let i = 0; i < 400; i++) {
          const link = document.querySelector('#exportResult a');
          if (link) {
            const buf = await (await fetch(link.href)).arrayBuffer();
            await fetch('http://127.0.0.1:${RECV_PORT}/up', {
              method: 'POST', headers: { 'x-filename': 'v3-scale-kf.mp4' }, body: buf,
            });
            return JSON.stringify({ size: buf.byteLength });
          }
          const err = document.querySelector('#exportError');
          if (err && !err.hidden && err.textContent) return JSON.stringify({ err: err.textContent });
          await new Promise(r => setTimeout(r, 200));
        }
        return JSON.stringify({ err: 'timeout' });
      })()
    `);
    const kfExport = JSON.parse(exportKf);
    check(
      'export MP4 (keyframes de transformation)',
      !kfExport.err && kfExport.size > 4000,
      kfExport.err || `${(kfExport.size / 1024).toFixed(0)} Ko`,
    );

    // ── WebM : même projet, autre conteneur ───────────────────────────
    const exportWebm = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        ctf.openExport();
        const f = document.querySelector('#exportFormat');
        f.value = 'webm';
        f.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
        document.querySelector('#startExportBtn').click();
        for (let i = 0; i < 400; i++) {
          const link = document.querySelector('#exportResult a');
          if (link) {
            const buf = await (await fetch(link.href)).arrayBuffer();
            await fetch('http://127.0.0.1:${RECV_PORT}/up', {
              method: 'POST', headers: { 'x-filename': 'v3-scale-kf.webm' }, body: buf,
            });
            return JSON.stringify({ size: buf.byteLength });
          }
          const err = document.querySelector('#exportError');
          if (err && !err.hidden && err.textContent) return JSON.stringify({ err: err.textContent });
          await new Promise(r => setTimeout(r, 200));
        }
        return JSON.stringify({ err: 'timeout' });
      })()
    `);
    const webm = JSON.parse(exportWebm);
    check('export WebM (VP9)', !webm.err && webm.size > 3000, webm.err || `${(webm.size / 1024).toFixed(0)} Ko`);

    // ── Moteur natif : le chemin natif est annoncé, sans repli ────────
    // Le moteur rend désormais keyframes, masques et vitesse : la fenêtre
    // d'export ne doit donc plus annoncer de bascule vers WebCodecs.
    const fallback = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const realMode = ctf.mode;
        ctf.mode = 'engine';
        ctf.updateExportSummary();
        const text = document.querySelector('#exportSummary').textContent;
        const blocked = document.querySelector('#startExportBtn').disabled;
        await new Promise(r => setTimeout(r, 600));
        const noticeHidden = document.querySelector('#exportEncoderNotice').hidden;
        ctf.mode = realMode;
        return {
          annonceNavigateur: /WebCodecs|dans le navigateur|in browser/i.test(text),
          parleNatif: /ffmpeg|moteur|engine/i.test(text),
          blocked,
          noticeHidden,
        };
      })()
    `);
    check(
      'mode moteur : chemin natif annoncé, aucun repli WebCodecs',
      fallback.annonceNavigateur === false && fallback.parleNatif === true && fallback.blocked === false,
      `repli=${fallback.annonceNavigateur} natif=${fallback.parleNatif} bloqué=${fallback.blocked}`,
    );

    // ── Ergonomie : dépôt sur une piste incompatible ──────────────────
    const dropCreate = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        // Le cas signalé : plus aucune piste vidéo, seulement une piste audio.
        ctf.project.tracks = [
          { id: 'a1', kind: 'audio', name: 'AUDIO 1', muted: false, volume: 1, clips: [] },
        ];
        ctf.selectedClipId = null;
        ctf.afterEdit();
        const media = ctf.project.media.find(m => m.kind === 'video');
        ctf.addMediaToTrack(media.id, 'a1', 0);
        const tracks = ctf.project.tracks.map(t => ({ kind: t.kind, name: t.name, n: t.clips.length }));
        return { tracks, selected: Boolean(ctf.selectedClipId), destroyed: !ctf.project.media.length };
      })()
    `);
    const videoTrack = dropCreate.tracks.find((t) => t.kind === 'video');
    check(
      'vidéo lâchée sur une piste audio : piste vidéo créée automatiquement',
      Boolean(videoTrack) && videoTrack.n === 1 && dropCreate.tracks.length === 2 && dropCreate.selected,
      dropCreate.tracks.map((t) => `${t.name}:${t.n}`).join(' + '),
    );

    const dropRedirect = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const media = ctf.project.media.find(m => m.kind === 'video');
        const before = ctf.project.tracks.map(t => t.name);
        // Dépôt d'une vidéo sur la ligne audio : une piste vidéo naît à cet
        // endroit, la piste audio reste intacte.
        const row = document.querySelector('.track-row.audio');
        const dt = new DataTransfer();
        dt.setData('application/x-ctf-media', media.id);
        const rect = row.getBoundingClientRect();
        row.dispatchEvent(new DragEvent('drop', {
          dataTransfer: dt, bubbles: true, cancelable: true,
          clientX: rect.left + 120, clientY: rect.top + 20,
        }));
        await new Promise(r => setTimeout(r, 250));
        return {
          before,
          kinds: ctf.project.tracks.map(t => t.kind),
          names: ctf.project.tracks.map(t => t.name),
          added: ctf.project.tracks.length - before.length,
          onAudio: ctf.project.tracks.find(t => t.kind === 'audio').clips.length,
          // La piste neuve occupe la ligne survolée (la ligne audio recule).
          newStart: ctf.project.tracks[0]?.clips[0]?.start_us ?? -1,
        };
      })()
    `);
    check(
      'vidéo déposée sur la ligne audio : piste vidéo créée, audio intacte',
      dropRedirect.added === 1 &&
        dropRedirect.kinds[0] === 'video' &&
        dropRedirect.onAudio === 0 &&
        Math.abs(dropRedirect.newStart - (120 / 64) * 1e6) < 120_000,
      `${dropRedirect.names.join(' | ')} — départ ${(dropRedirect.newStart / 1e6).toFixed(2)} s`,
    );

    const dropBelow = await cdp.eval(`
      (async () => {
        try {
          const ctf = window.ctf;
          const media = ctf.project.media.find(m => m.kind === 'video');
          const scroll = document.querySelector('#timelineScroll');
          const dt = new DataTransfer();
          dt.setData('application/x-ctf-media', media.id);
          const rect = scroll.getBoundingClientRect();
          // Sous la dernière piste : aucune \`.track-row\` sous le curseur.
          scroll.dispatchEvent(new DragEvent('drop', {
            dataTransfer: dt, bubbles: true, cancelable: true,
            clientX: rect.left + 200, clientY: rect.bottom - 4,
          }));
          await new Promise(r => setTimeout(r, 250));
          const total = ctf.project.tracks.reduce((n, t) => n + t.clips.length, 0);
          return { total, tracks: ctf.project.tracks.length };
        } catch (error) {
          return { error: String(error && error.stack || error) };
        }
      })()
    `);
    check(
      'dépôt sous la dernière piste : accepté',
      dropBelow.total >= 3,
      dropBelow.error || `${dropBelow.total} clips sur ${dropBelow.tracks} pistes`,
    );

    // ── Ergonomie : molette dans la timeline ──────────────────────────
    const wheel = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const scroll = document.querySelector('#timelineScroll');
        ctf.zoom = 80;
        scroll.scrollLeft = 0;
        ctf.timeline.render();
        const before = { zoom: ctf.zoom, scrollLeft: scroll.scrollLeft, pageScale: window.visualViewport.scale };
        const rect = scroll.getBoundingClientRect();
        const mk = (opts) => new WheelEvent('wheel', {
          bubbles: true, cancelable: true, clientX: rect.left + 300, clientY: rect.top + 60, ...opts,
        });
        const zoomEvent = mk({ deltaY: -240, ctrlKey: true });
        scroll.dispatchEvent(zoomEvent);
        await new Promise(r => setTimeout(r, 120));
        const afterZoom = { zoom: ctf.zoom, scrollLeft: scroll.scrollLeft, pageScale: window.visualViewport.scale, prevented: zoomEvent.defaultPrevented };
        const scrollEvent = mk({ deltaY: 160 });
        scroll.dispatchEvent(scrollEvent);
        await new Promise(r => setTimeout(r, 120));
        return { before, afterZoom, afterScroll: { scrollLeft: scroll.scrollLeft, prevented: scrollEvent.defaultPrevented } };
      })()
    `);
    check(
      'Ctrl+molette : zoome la timeline, pas l’interface',
      wheel.afterZoom.zoom > wheel.before.zoom * 1.2 &&
        wheel.afterZoom.pageScale === wheel.before.pageScale &&
        wheel.afterZoom.prevented === true,
      `zoom ${wheel.before.zoom} → ${wheel.afterZoom.zoom.toFixed(1)} px/s, page ×${wheel.afterZoom.pageScale}`,
    );
    check(
      'molette seule : défile horizontalement',
      wheel.afterScroll.scrollLeft > wheel.afterZoom.scrollLeft + 100 && wheel.afterScroll.prevented,
      `scrollLeft ${wheel.afterZoom.scrollLeft.toFixed(0)} → ${wheel.afterScroll.scrollLeft.toFixed(0)} px`,
    );
    // ── Ergonomie : scrub pendant la lecture ──────────────────────────
    const liveScrub = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        ctf.project.tracks.forEach(t => { t.clips.length = 0; });
        const media = ctf.project.media.find(m => m.kind === 'video');
        const v = ctf.project.tracks.find(t => t.kind === 'video');
        ctf.addMediaToTrack(media.id, v.id, 0);
        await new Promise(r => setTimeout(r, 400));
        ctf.setTime(0);
        ctf.preview.play();
        await new Promise(r => setTimeout(r, 900));
        const before = ctf.preview.timeUs;
        // Geste de l'utilisateur : clic sur la règle pendant la lecture.
        ctf.setTime(4_000_000);
        const justAfter = ctf.preview.timeUs;
        await new Promise(r => setTimeout(r, 600));
        const drifting = ctf.preview.timeUs;
        const stillPlaying = ctf.preview.playing;
        ctf.preview.pause();
        return { before, justAfter, drifting, stillPlaying, end: ctf.project.tracks[0].clips[0].duration_us };
      })()
    `);
    check(
      'tête de lecture utilisable pendant la lecture',
      liveScrub.justAfter > 3_900_000 &&
        liveScrub.drifting > liveScrub.justAfter &&
        liveScrub.stillPlaying === true,
      `${(liveScrub.before / 1e6).toFixed(2)} s → ${(liveScrub.justAfter / 1e6).toFixed(2)} s, puis ${(
        liveScrub.drifting / 1e6
      ).toFixed(2)} s (lecture poursuivie)`,
    );

    // ── Ergonomie : dézoom extrême + cadrage ──────────────────────────
    const deepZoom = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const view = document.querySelector('#timelineScroll');
        ctf.zoom = 64;
        ctf.timeline.render();
        for (let i = 0; i < 40; i++) document.querySelector('#btn-zoom-out').click();
        const min = ctf.zoom;
        const ticks = document.querySelectorAll('#ruler .tick').length;
        ctf.fitTimeline();
        const fitted = ctf.zoom;
        const fitsViewport = (ctf.project.tracks[0].clips[0].duration_us / 1e6) * fitted <= view.clientWidth + 2;
        document.querySelector('#btn-zoom-in').click();
        const zoomedBack = ctf.zoom;
        return { min, ticks, fitted, fitsViewport, zoomedBack, readout: document.querySelector('#statusZoom').textContent };
      })()
    `);
    check(
      'dézoom étendu (0,25 px/s) et graduations adaptées',
      deepZoom.min === 0.25 && deepZoom.ticks > 0 && deepZoom.ticks < 400,
      `${deepZoom.min} px/s, ${deepZoom.ticks} graduations visible(s), statut « ${deepZoom.readout} »`,
    );
    check(
      'cadrage automatique de tout le montage',
      deepZoom.fitsViewport && deepZoom.zoomedBack > deepZoom.fitted,
      `zoom ajusté ${deepZoom.fitted.toFixed(1)} px/s → +1 cran ${deepZoom.zoomedBack.toFixed(1)} px/s`,
    );

    // ── Ergonomie : ajout par clic (pas un dépôt) ─────────────────────
    const clickAdd = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        ctf.project.tracks = [
          { id: 'v1', kind: 'video', name: 'VIDEO 1', muted: false, volume: 1, clips: [] },
        ];
        const media = ctf.project.media.find(m => m.kind === 'video');
        // Sans l'option newTrack : on réutilise la piste compatible existante.
        ctf.addMediaToTrack(media.id, 'v1', 0);
        const first = ctf.project.tracks.length;
        // Deuxième ajout au même instant : le clip se cale après le premier.
        ctf.addMediaToTrack(media.id, 'v1', 0);
        const clips = ctf.project.tracks[0].clips;
        return {
          tracks: ctf.project.tracks.length,
          first,
          starts: clips.map(c => c.start_us),
          count: clips.length,
        };
      })()
    `);
    check(
      'ajout par clic : même piste, clips empilés à la suite',
      clickAdd.tracks === 1 &&
        clickAdd.count === 2 &&
        clickAdd.starts[0] === 0 &&
        clickAdd.starts[1] === 6_000_000,
      `${clickAdd.count} clips sur ${clickAdd.tracks} piste, départs ${clickAdd.starts
        .map((s) => (s / 1e6).toFixed(2) + 's')
        .join(' / ')}`,
    );

    // ── Ergonomie : règle compacte quand la timeline est repliée ──────
    const collapsedScrub = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const shell = document.querySelector('.app-shell');
        shell.dataset.timeline = 'off';
        const strip = document.querySelector('#timelineScrub');
        const visible = getComputedStyle(strip).display !== 'none';
        const rail = strip.getBoundingClientRect();
        const before = ctf.timeUs;
        const dt = new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, button: 0,
          clientX: rail.left + rail.width * 0.5, clientY: rail.top + rail.height / 2,
        });
        strip.dispatchEvent(dt);
        await new Promise(r => setTimeout(r, 120));
        const after = ctf.timeUs;
        const end = ctf.project.tracks.reduce((m, t) => Math.max(m, t.clips.reduce((n, c) => Math.max(n, c.start_us + c.duration_us), 0)), 0);
        const knob = parseFloat(document.querySelector('#scrubKnob').style.left) || 0;
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        shell.dataset.timeline = 'on';
        return { visible, before, after, end, knob, railWidth: Math.round(rail.width) };
      })()
    `);
    check(
      'timeline repliée : règle fine pleine largeur pour se déplacer',
      collapsedScrub.visible &&
        collapsedScrub.railWidth > 600 &&
        Math.abs(collapsedScrub.after - collapsedScrub.end / 2) < collapsedScrub.end * 0.06 &&
        collapsedScrub.knob > 40,
      `${collapsedScrub.railWidth} px de large, clic au milieu → ${(collapsedScrub.after / 1e6).toFixed(2)} s / ${(
        collapsedScrub.end / 1e6
      ).toFixed(2)} s`,
    );
    // ── Ergonomie : poignée de tête de lecture ────────────────────────
    const handle = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        ctf.zoom = 64;
        ctf.timeline.render();
        ctf.setTime(1_000_000);
        const head = document.querySelector('#playhead');
        const content = document.querySelector('#timelineContent').getBoundingClientRect();
        const startX = content.left + 64; // 1 s à 64 px/s
        const headRect = head.getBoundingClientRect();
        head.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, button: 0, clientX: startX, clientY: headRect.top + 8,
        }));
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: startX + 128 }));
        const dragged = ctf.timeUs;
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

        // Un clic sur un clip, à 30 px sous la règle, doit encore sélectionner le clip.
        const clip = document.querySelector('.clip');
        const box = clip.getBoundingClientRect();
        clip.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, button: 0, clientX: box.left + 40, clientY: box.top + 30,
        }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        return { dragged, selected: ctf.selectedClipId === clip.dataset.clipId };
      })()
    `);
    check(
      'tête de lecture déplaçable à la souris (128 px = +2 s)',
      Math.abs(handle.dragged - 3_000_000) < 60_000 && handle.selected === true,
      `${(handle.dragged / 1e6).toFixed(2)} s ; clip voisin toujours sélectionnable : ${handle.selected}`,
    );
    // ── Dépôt = piste neuve, pile à l'instant déposé ──────────────────
    const dropNewTrack = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const media = ctf.project.media.find(m => m.kind === 'video');
        // Une piste déjà remplie de 0 à 3 s : le piège de l'ancien comportement.
        const v = ctf.project.tracks.find(t => t.kind === 'video');
        v.clips.length = 0;
        ctf.project.tracks = [v];
        ctf.addMediaToTrack(media.id, v.id, 0);
        await new Promise(r => setTimeout(r, 150));
        const before = ctf.project.tracks.length;
        ctf.zoom = 64;
        ctf.timeline.render();
        // Dépôt à 2,5 s sur la piste occupée.
        const row = document.querySelector('.track-row.video');
        const rect = row.getBoundingClientRect();
        const dt = new DataTransfer();
        dt.setData('application/x-ctf-media', media.id);
        row.dispatchEvent(new DragEvent('drop', {
          dataTransfer: dt, bubbles: true, cancelable: true,
          clientX: rect.left + 2.5 * 64, clientY: rect.top + 20,
        }));
        await new Promise(r => setTimeout(r, 250));
        const added = ctf.project.tracks.length - before;
        // La piste neuve prend la place de la ligne survolée (index du dépôt).
        const fresh = ctf.project.tracks[0];
        return {
          added,
          kindOfNew: fresh?.kind,
          start: fresh?.clips[0]?.start_us ?? -1,
          clipsOnOld: ctf.project.tracks[1]?.clips.length,
          tracks: ctf.project.tracks.map(t => t.name),
        };
      })()
    `);
    check(
      'dépôt depuis le chutier : piste neuve, clip à l’instant déposé',
      dropNewTrack.added === 1 &&
        dropNewTrack.kindOfNew === 'video' &&
        dropNewTrack.clipsOnOld === 1 &&
        Math.abs(dropNewTrack.start - 2_500_000) < 70_000,
      `+1 piste (${dropNewTrack.kindOfNew}) à ${(dropNewTrack.start / 1e6).toFixed(2)} s, sans toucher à l’ancienne → ${dropNewTrack.tracks.join(' | ')}`,
    );

    const dropAudioTrack = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const media = ctf.project.media[0];
        const audio = { ...media, id: 'audio-drop', kind: 'audio', name: 'audio-drop.mp3' };
        ctf.project.media.push(audio);
        const before = ctf.project.tracks.length;
        const row = document.querySelector('.track-row.video');
        const rect = row.getBoundingClientRect();
        const dt = new DataTransfer();
        dt.setData('application/x-ctf-media', 'audio-drop');
        row.dispatchEvent(new DragEvent('drop', {
          dataTransfer: dt, bubbles: true, cancelable: true,
          clientX: rect.left + 64, clientY: rect.top + 20,
        }));
        await new Promise(r => setTimeout(r, 250));
        return {
          added: ctf.project.tracks.length - before,
          kinds: ctf.project.tracks.map(t => t.kind),
          names: ctf.project.tracks.map(t => t.name),
        };
      })()
    `);
    check(
      'un média audio déposé construit bien une piste audio',
      dropAudioTrack.added === 1 &&
        dropAudioTrack.kinds[0] === 'audio' &&
        dropAudioTrack.kinds[1] === 'video',
      dropAudioTrack.names.join(' | '),
    );

    // ── Mise à jour : bandeau, pas de bascule imposée ─────────────────
    const updateFlow = await cdp.eval(`
      (async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        const banner = document.querySelector('#updateBanner');
        return {
          hasBanner: Boolean(banner),
          hiddenByDefault: banner ? banner.hidden : null,
          hasRegistration: Boolean(reg),
          controller: Boolean(navigator.serviceWorker.controller),
        };
      })()
    `);
    check(
      'bandeau de mise à jour présent et masqué par défaut',
      updateFlow.hasBanner === true && updateFlow.hiddenByDefault === true,
      `enregistrement=${updateFlow.hasRegistration}, contrôleur=${updateFlow.controller}`,
    );

    // ── Version affichée dans les Préférences ─────────────────────────
    const versionUi = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        ctf.openPreferences();
        await new Promise(r => setTimeout(r, 200));
        const line = document.querySelector('#prefsVersion');
        const visible = Boolean(line) && line.offsetParent !== null;
        const text = line ? line.textContent.trim() : '';
        const modal = document.querySelector('#prefsModal');
        modal.classList.remove('is-open');
        return { visible, text };
      })()
    `);
    check(
      'version du studio affichée dans les Préférences',
      versionUi.visible === true && /^Studio \d+\.\d+\.\d+/.test(versionUi.text),
      `« ${versionUi.text} »`,
    );

    // Même ligne quand un moteur répond : la version vient de /api/health.
    const versionEngine = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const wasOk = ctf.engineOk;
        const wasVersion = ctf.engineVersion;
        ctf.engineOk = true;
        ctf.engineVersion = '0.7.0';
        ctf.openPreferences();
        await new Promise(r => setTimeout(r, 150));
        const text = document.querySelector('#prefsVersion').textContent.trim();
        document.querySelector('#prefsModal').classList.remove('is-open');
        ctf.engineOk = wasOk;
        ctf.engineVersion = wasVersion;
        return text;
      })()
    `);
    check(
      'avec un moteur : studio et moteur sur la même ligne',
      /Studio \d+\.\d+\.\d+ · (moteur|engine) 0\.7\.0/.test(versionEngine),
      `« ${versionEngine} »`,
    );
    // ── Pastille d'état : « dans le navigateur », pas « hors ligne » ───
    //
    // Régression corrigée : sur un hébergement statique, `engineOk` est faux par
    // construction et la pastille affichait « offline » en rouge. Rien n'est
    // hors ligne — le studio travaille dans le navigateur.
    const badge = await cdp.eval(`
      (async () => {
        const ctf = window.ctf;
        const read = () => {
          const b = document.querySelector('#engineBadge');
          const dot = b.querySelector('.engine-dot');
          return {
            state: b.dataset.state,
            label: document.querySelector('#engineLabel').textContent,
            title: b.title,
            color: getComputedStyle(dot).backgroundColor,
            labelColor: getComputedStyle(document.querySelector('#engineLabel')).color,
          };
        };
        const wasMode = ctf.mode;
        const wasOk = ctf.engineOk;
        ctf.mode = 'local';
        ctf.engineOk = false;
        ctf.updateEngineBadge();
        const local = read();
        ctf.mode = 'engine';
        ctf.engineOk = true;
        ctf.updateEngineBadge();
        const engine = read();
        ctf.mode = 'engine';
        ctf.engineOk = false;
        ctf.updateEngineBadge();
        const lost = read();
        ctf.mode = wasMode;
        ctf.engineOk = wasOk;
        ctf.updateEngineBadge();
        return { local, engine, lost };
      })()
    `);
    const red = /rgb\(255,\s*93,\s*93\)/.test(badge.local.color) || /rgb\(255,\s*93,\s*93\)/.test(badge.local.labelColor);
    check(
      'mode navigateur : pastille informative, jamais rouge « offline »',
      badge.local.state === 'browser' && !red && badge.local.label !== 'offline' && badge.local.title.length > 20,
      `« ${badge.local.label} » (${badge.local.state}, ${badge.local.color})`,
    );
    check(
      'moteur joignable : vert « moteur », moteur perdu : rouge',
      badge.engine.state === 'ok' && badge.lost.state === 'bad',
      `« ${badge.engine.label} » / « ${badge.lost.label} »`,
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
    server.close();
    recv.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests OK`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  if (failed.length) process.exitCode = 1;
  // Chrome laisse des enfants : on coupe court au lieu d'attendre le GC.
  setTimeout(() => process.exit(failed.length ? 1 : 0), 300).unref();
}

main().catch((e) => {
  console.error('❌ ÉCHEC:', e.message);
  process.exit(1);
});