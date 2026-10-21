/**
 * BANC DE RÉGRESSION — montage complet multi-pistes, exports et aller-retour projet.
 * ================================================================================
 * Construit un montage de 13 s sur 5 pistes (vidéo ×2 + image + texte + forme +
 * 2 pistes audio), l'exporte en MP4 / WEBM / MP3, l'enregistre en .ctf ET .json,
 * recharge la page, recharge les deux fichiers, puis VÉRIFIE tout avec ffmpeg.
 *
 *   node tools/regression/montage.cjs
 *
 * Voir README.md pour le détail de ce qui est mesuré et pourquoi.
 */
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FFMPEG = (() => {
  const w = spawnSync('where', ['ffmpeg'], { encoding: 'utf8' });
  if (w.status === 0) return w.stdout.split(/\r?\n/)[0].trim();
  return 'C:\\Users\\zigmoon\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0-full_build\\bin\\ffmpeg.exe';
})();
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');

const PROJ = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'out');
const MEDIA = path.join(__dirname, 'media');
const PROFILE = path.join(__dirname, '.chrome-profile');
const PORT = 9601;
const DEBUG_PORT = 9340;

const EXPECTED = { duration: 13, fps: 30, frames: 390 };
/** Mode court : uniquement le montage + l'export MP4 (diagnostic / mise au point). */
const QUICK = process.argv.includes('--quick');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
});

// ─────────────────────────── CDP minimal ───────────────────────────
class CDP {
  constructor(ws, label) { this.ws = ws; this.label = label; this.id = 0; this.pending = new Map(); }
  static async connect(u, label) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const c = new CDP(ws, label || 'page');
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        const p = c.pending.get(m.id); c.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        const t = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        if (!t || /^%c[━│─═]/.test(t)) return;   // bandeaux décoratifs de la console
        console.log(`   [${c.label}] ${t.slice(0, 190)}`);
      } else if (m.method === 'Runtime.exceptionThrown') {
        console.log(`   [${c.label}] ‼️ ${(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 300)}`);
      }
    });
    return c;
  }
  send(method, params) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params: params || {} })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
}

// ─────────────────────── Analyse ffmpeg ───────────────────────
function goertzel(samples, offset, len, sampleRate, freq) {
  const k = Math.round((len * freq) / sampleRate);
  const w = (2 * Math.PI * k) / len;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) { s0 = samples[offset + i] + coeff * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / len;
}
function decodePcm(file, sampleRate = 48000) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-'], { maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error('ffmpeg decode: ' + r.stderr.toString().slice(0, 300));
  const buf = r.stdout, n = buf.length >> 1, f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = buf.readInt16LE(i * 2) / 32768;
  return f;
}
/**
 * ⚠️ NE PAS réintroduire de détecteur « fréquence dominante par fenêtre » ici.
 * Ce montage superpose une musique CONTINUE (300 Hz) au son des clips vidéo
 * (440/880 Hz) : les deux sont présents en même temps, la dominante oscille d'une
 * fenêtre de 10 ms à l'autre (battements) et le détecteur annonçait **33 bascules**
 * au lieu des 4 réelles — de quoi accuser à tort la synchronisation de l'export.
 * Les repères se mesurent PAR FRÉQUENCE : voir `freqRanges()` et `REPERES`.
 */
/**
 * Plages de temps pendant lesquelles une fréquence repère est PRÉSENTE.
 *
 * ⚠️ Pourquoi pas « la fréquence dominante par fenêtre » (1ʳᵉ version du banc) :
 * ce montage superpose une musique CONTINUE (300 Hz) au son des clips vidéo
 * (440/880 Hz). Les deux sont présents en même temps, la dominante oscille
 * d'une fenêtre de 10 ms à l'autre à cause des battements, et le détecteur
 * annonçait **33 bascules** au lieu des 4 réelles. En suivant chaque fréquence
 * séparément (seuil relatif à son propre maximum), la mesure redevient nette.
 *
 * @returns {{peak:number, ranges:Array<[number,number]>}} plages en secondes
 */
function freqRanges(samples, sampleRate, freq, ratio = 0.25, winSec = 0.02) {
  const win = Math.round(winSec * sampleRate);
  const mags = [];
  for (let off = 0; off + win <= samples.length; off += win) {
    mags.push({ t: off / sampleRate, m: goertzel(samples, off, win, sampleRate, freq) });
  }
  if (!mags.length) return { peak: 0, ranges: [] };
  const peak = Math.max(...mags.map((x) => x.m));
  const thr = peak * ratio;
  const ranges = [];
  let start = null;
  for (const x of mags) {
    const on = x.m >= thr;
    if (on && start === null) start = x.t;
    else if (!on && start !== null) {
      if (x.t - start > 0.15) ranges.push([+start.toFixed(3), +x.t.toFixed(3)]);
      start = null;
    }
  }
  if (start !== null) ranges.push([+start.toFixed(3), +mags[mags.length - 1].t.toFixed(3)]);
  return { peak, ranges };
}

/** Luminance MAXIMALE (0-255) d'une zone : détecte un texte blanc sur fond coloré. */
const maxLumaAt = (file, t, crop) => {
  const vf = (crop ? `crop=${crop},` : '') + 'format=gray';
  const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
  if (!r.stdout || !r.stdout.length) return null;
  // ⚠️ PAS de `Math.max(...r.stdout)` : la zone fait ~220 000 octets et le spread
  //    dépasse la taille de pile (déjà rencontré dans le muxeur WebM) → boucle.
  let max = 0;
  for (let i = 0; i < r.stdout.length; i++) if (r.stdout[i] > max) max = r.stdout[i];
  return max;
};

const lumaAt = (file, t) => {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
  return r.stdout.length ? r.stdout[0] : null;
};
/** Couleur moyenne (R,G,B) à un instant donné, éventuellement dans une zone recadrée. */
const rgbAt = (file, t, crop) => {
  const vf = (crop ? `crop=${crop},` : '') + 'scale=1:1,format=rgb24';
  const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
  return r.stdout.length >= 3 ? [r.stdout[0], r.stdout[1], r.stdout[2]] : null;
};
const probe = (file, args) => {
  const r = spawnSync(FFPROBE, ['-v', 'error', ...args, '-of', 'json', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
  try { return JSON.parse(r.stdout); } catch { return {}; }
};

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`   ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

// ───────────────────────────────────────────────────────────────────────
(async () => {
  for (const f of ['a.mp4', 'b.mp4', 'img.png', 'music.wav', 'beep.wav']) {
    if (!fs.existsSync(path.join(MEDIA, f))) {
      console.error(`❌ Média manquant : ${f}\n   → lancez d'abord : powershell -ExecutionPolicy Bypass -File tools/regression/make-media.ps1`);
      process.exit(1);
    }
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const srv = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), String(PORT), PROJ], { stdio: 'ignore' });

  // ⚠️ UN CHROME DÉJÀ PRÉSENT FAUSSE TOUT : le nouveau lancement n'ouvre pas de
  //    serveur de debug (le port est pris), le CDP se connecte au VIEUX navigateur
  //    dont on vient pourtant de supprimer le profil → imports qui échouent
  //    (« durée invalide (0) ») ou export qui n'avance plus. On refuse d'emblée.
  const busy = await getJSON(`http://127.0.0.1:${DEBUG_PORT}/json/version`).catch(() => null);
  if (busy) {
    console.error(`❌ Un navigateur écoute déjà le port de debug ${DEBUG_PORT} (${busy.Browser}).\n` +
                  `   Fermez-le (Stop-Process -Name chrome) puis relancez le banc.`);
    process.exit(1);
  }

  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,900',
    // ⚠️ INDISPENSABLE (constaté le 2026-09-17) — un export dure plusieurs minutes
    //    et la fenêtre n'est pas au premier plan (on travaille dans l'éditeur).
    //    Chrome bride alors les `setTimeout` des onglets non visibles À 1 SECONDE,
    //    puis les GÈLE complètement : la boucle d'encodage (qui fait
    //    `await setTimeout(r, 1)` entre les images) se retrouve bloquée et l'export
    //    n'avance plus — l'onglet a l'air vivant mais reste figé à 271/390 images.
    //    Ces drapeaux désactivent le bridage ET le gel.
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
    'about:blank',
  ], { stdio: 'ignore' });
  // `kill()` sur le lanceur ne tue pas les processus enfants de Chrome : on tue
  // l'arbre complet en fin de run (sinon un Chrome fantôme reste sur le port de
  // debug et fait échouer le run suivant — voir la vérification ci-dessus).
  const killChrome = () => {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
      else chrome.kill('SIGKILL');
    } catch (_) {}
  };

  const report = {};
  let cdp = null;
  try {
    // ── Chrome + page ───────────────────────────────────────────────────
    let version = null;
    for (let i = 0; i < 60; i++) { try { version = await getJSON(`http://127.0.0.1:${DEBUG_PORT}/json/version`); break; } catch { await sleep(500); } }
    if (!version) throw new Error('Chrome CDP indisponible');
    console.log('Chrome : ' + version.Browser);

    let page = null;
    for (let i = 0; i < 20 && !page; i++) { page = (await getJSON(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).find((t) => t.type === 'page'); if (!page) await sleep(500); }
    cdp = await CDP.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    /** Charge l'app et attend qu'elle soit prête (le SW provoque un rechargement). */
    const openApp = async (url) => {
      await cdp.send('Page.navigate', { url });
      await sleep(9000);
      await cdp.send('Runtime.disable').catch(() => {});
      await cdp.send('Runtime.enable');
      for (let i = 0; i < 60; i++) {
        if (await cdp.eval('typeof window.app !== "undefined" && !!window.app.tracks').catch(() => false)) return true;
        await sleep(500);
      }
      return false;
    };

    console.log('\n▶ Chargement de l\'application…');
    if (!(await openApp(`http://127.0.0.1:${PORT}/index.html?reg=${Date.now()}`))) throw new Error("L'application ne s'est pas initialisée");
    console.log('   ' + JSON.stringify(await cdp.eval('({modules: [typeof window.CTFFrameSource, typeof window.startMp3Export, typeof window.startWebMWebCodecsExport], lame: typeof lamejs, version: CutTheFlow.APP_VERSION})')));

    // ── Montage ─────────────────────────────────────────────────────────
    console.log('\n▶ Montage 13 s / 5 pistes (video + image + texte + forme + 2 audio)…');
    const built = await cdp.eval(`(async () => {
      const grab = async (u, n) => {
        const b = await (await fetch(u)).blob();
        const ext = n.split('.').pop();
        const type = ext === 'png' ? 'image/png' : (ext === 'wav' ? 'audio/wav' : 'video/mp4');
        return new File([b], n, { type });
      };
      // Remise à zéro
      if (app.isPlaying) app.pause();
      app.tracks = []; app.mediaLibrary = [];
      app.clipIdCounter = 1; app.trackIdCounter = 1; app.mediaIdCounter = 1;

      const base = '/tools/regression/media/';
      await app.handleFiles([
        await grab(base + 'a.mp4', 'a.mp4'),
        await grab(base + 'b.mp4', 'b.mp4'),
        await grab(base + 'img.png', 'img.png'),
        await grab(base + 'music.wav', 'music.wav'),
        await grab(base + 'beep.wav', 'beep.wav')
      ]);

      const T = {};
      for (const n of ['VIDEO 1', 'VIDEO 2', 'VIDEO 3', 'AUDIO 1', 'AUDIO 2']) { app.addTrack(n); T[n] = app.tracks[app.tracks.length - 1].id; }

      const M = (n) => app.mediaLibrary.find(m => m.name === n);
      const clip = (media, start, dur) => {
        const c = app.addClipToTrack(media, T[media.type === 'audio' ? (start === 0 ? 'AUDIO 1' : 'AUDIO 2') : 'VIDEO 3'], start);
        if (dur !== undefined) c.duration = dur;
        return c;
      };

      clip(M('a.mp4'), 0);                        // 0 → 6 s
      clip(M('img.png'), 6, 3);                   // 6 → 9 s (image)
      clip(M('b.mp4'), 9);                        // 9 → 13 s
      clip(M('music.wav'), 0, 13);                // piste audio de fond
      clip(M('beep.wav'), 6);                     // piste audio d'appoint 6 → 9 s

      // Texte (premier plan) 6,5 → 8,5 s — AU-DESSUS DE L'IMAGE UNIE : les mesures de
      // couleur deviennent déterministes (une vidéo de test bouge, donc toute mesure
      // de teinte sur un clip vidéo serait bruitée).
      const txt = { id: app.clipIdCounter++, trackId: T['VIDEO 1'], type: 'text', name: 'Text Layer',
        content: 'TITRE', startTime: 6.5, duration: 2, sourceStart: 0, sourceDuration: Infinity,
        posX: 50, posY: 30,
        style: { color: '#ffffff', fontSize: '140px', fontFamily: 'Arial', fontWeight: 'bold', shadowEnabled: true, shadowColor: 'rgba(0,0,0,0.9)', shadowBlur: 8, shadowOffsetX: 0, shadowOffsetY: 4 } };
      // Forme (bloc bleu 40 % d'écran, semi-transparent) 6,5 → 8,5 s
      const blk = { id: app.clipIdCounter++, trackId: T['VIDEO 2'], type: 'block', name: 'Color Block',
        color: '#0066ff', startTime: 6.5, duration: 2, sourceStart: 0, sourceDuration: Infinity,
        opacity: 0.8, width: 40, height: 40, posX: 10, posY: 55 };
      app.tracks.find(t => t.id === T['VIDEO 1']).clips.push(txt);
      app.tracks.find(t => t.id === T['VIDEO 2']).clips.push(blk);

      app._invalidateTimelineEndCache();
      app.renderTracks(); app.updatePreview();

      return {
        end: app.getTimelineEndTime(),
        tracks: app.tracks.map(t => ({ name: t.name, clips: t.clips.map(c => ({ type: c.type, name: c.name, start: +c.startTime.toFixed(3), dur: +c.duration.toFixed(3) })) })),
        media: app.mediaLibrary.map(m => m.name + (m.fps ? ' (' + m.fps + 'fps)' : ''))
      };
    })()`, true);
    console.log('   durée = ' + built.end + ' s · sources : ' + built.media.join(', '));
    for (const t of built.tracks) console.log(`   ${t.name.padEnd(9)} ${t.clips.map(c => `${c.type}@${c.start}+${c.dur}`).join('  ')}`);
    report.montage = built;
    check('Durée de la timeline = 13 s', Math.abs(built.end - EXPECTED.duration) < 0.01, built.end + ' s');

    // ── Exports ─────────────────────────────────────────────────────────
    /**
     * Lance un export SANS bloquer sur la promesse : `Runtime.evaluate` avec
     * `awaitPromise` n'a aucun délai maximum côté CDP, donc un export qui se bloque
     * fige tout le banc sans aucune sortie. On démarre en tâche de fond et on
     * SURVEILLE la progression via l'interface, avec un délai maximum explicite.
     */
    const doExport = async (label, format, engineFn) => {
      console.log(`\n▶ Export ${label}…`);
      await cdp.eval(`(() => {
        window.__regExportDone = false; window.__regExportResult = null; window.__regExportError = null;
        app.selectExportFormat('${format}');
        app.selectedResolution = '1280x720';
        app.selectedFps = 30;
        const t0 = performance.now();
        Promise.resolve()
          .then(() => ${engineFn}(app))
          .then(async () => {
            const seconds = (performance.now() - t0) / 1000;
            const r = await fetch('http://127.0.0.1:${PORT}/__upload?name=export.${format}', { method: 'POST', body: app.exportedVideoBlob });
            window.__regExportResult = { ok: r.ok, seconds: +seconds.toFixed(1), size: app.exportedVideoBlob.size, mime: app.exportedVideoBlob.type, engine: app.selectedEncoder };
          })
          .catch(e => { window.__regExportError = String((e && e.message) || e); })
          .finally(() => { window.__regExportDone = true; });
        return 'started';
      })()`);

      const t0 = Date.now();
      let last = '';
      for (;;) {
        await sleep(3000);
        const st = await cdp.eval(`({
          done: !!window.__regExportDone,
          err: window.__regExportError,
          status: (document.getElementById('exportStatus') || {}).textContent || '',
          progress: (document.querySelector('#exportProgressFill') || {}).style ? document.querySelector('#exportProgressFill').style.width : '',
          exporting: !!app.isExporting
        })`).catch(() => ({ done: false, status: '(évaluation impossible)' }));
        const line = `${st.progress || '?'} · ${st.status || ''}`;
        if (line !== last) { console.log(`   … ${line}`); last = line; }
        if (st.done) {
          if (st.err) throw new Error(`${label} : ${st.err}`);
          const res = await cdp.eval('window.__regExportResult');
          console.log('   ' + JSON.stringify(res));
          report['export_' + format] = res;
          return res;
        }
        if (Date.now() - t0 > 300000) throw new Error(`${label} : délai maximum dépassé (300 s) — dernier statut : ${st.status}`);
      }
    };
    await doExport('MP4 (H.264 + AAC)', 'mp4', 'startWebCodecsExport');
    if (QUICK) {
      fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
      console.log('(mode --quick : arrêt après l\'export MP4)');
      return;
    }
    await doExport('WEBM (VP9 + Opus)', 'webm', 'startWebMWebCodecsExport');
    await doExport('MP3 (audio seul)', 'mp3', 'startMp3Export');

    // ── Enregistrement du projet (.ctf et .json) ────────────────────────
    console.log('\n▶ Enregistrement du projet en .ctf puis .json…');
    const saves = await cdp.eval(`(async () => {
      // On neutralise le téléchargement pour RÉCUPÉRER le fichier produit par
      // l'application (chemin réel : <a download>.click()), puis on l'envoie au banc.
      const origRevoke = URL.revokeObjectURL;
      const origClick = HTMLAnchorElement.prototype.click;
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function () { captured = { href: this.href, name: this.download }; };
      let captured = null;
      const grabBlob = async (fn) => {
        captured = null;
        await fn();
        if (!captured) throw new Error('aucun fichier capturé');
        const blob = await (await fetch(captured.href)).blob();
        return { blob, name: captured.name };
      };
      const out = {};
      try {
        app.projectName = 'Banc de régression';
        const ctf = await grabBlob(() => app.saveAsCtf('Banc de régression'));
        out.ctfSize = ctf.blob.size; out.ctfName = ctf.name;
        await fetch('http://127.0.0.1:${PORT}/__upload?name=project.ctf', { method: 'POST', body: ctf.blob });

        const js = await grabBlob(() => app.saveAsJson('Banc de régression'));
        out.jsonSize = js.blob.size; out.jsonName = js.name;
        await fetch('http://127.0.0.1:${PORT}/__upload?name=project.json', { method: 'POST', body: js.blob });
      } finally {
        HTMLAnchorElement.prototype.click = origClick;
        URL.revokeObjectURL = origRevoke;
      }
      return out;
    })()`, true);
    console.log('   ' + JSON.stringify(saves));
    report.saves = saves;

    // Inspecte le JSON produit (le .ctf contient le même project.json)
    const ctfPath = path.join(OUT, 'project.ctf');
    const jsonPath = path.join(OUT, 'project.json');
    check('.ctf produit', fs.existsSync(ctfPath) && fs.statSync(ctfPath).size > 1000, fs.existsSync(ctfPath) ? (fs.statSync(ctfPath).size / 1024).toFixed(0) + ' Ko' : 'absent');
    check('.json produit', fs.existsSync(jsonPath) && fs.statSync(jsonPath).size > 500, fs.existsSync(jsonPath) ? (fs.statSync(jsonPath).size / 1024).toFixed(0) + ' Ko' : 'absent');

    const jsonProject = JSON.parse(fs.readFileSync(jsonPath, 'utf8'), (k, v) => v === '__INF__' ? Infinity : v);
    report.jsonProjectSummary = {
      version: jsonProject.version, appVersion: jsonProject.appVersion, format: jsonProject.format,
      selectedFormat: jsonProject.selectedFormat, selectedResolution: jsonProject.selectedResolution,
      selectedFps: jsonProject.selectedFps, tracks: jsonProject.tracks.length,
      clips: jsonProject.tracks.reduce((s, t) => s + t.clips.length, 0),
      media: jsonProject.mediaLibrary.length
    };
    console.log('   ' + JSON.stringify(report.jsonProjectSummary));
    check('.json : appVersion présente', !!jsonProject.appVersion, jsonProject.appVersion);
    check('.json : selectedFormat enregistré', ['mp4', 'webm', 'mp3'].includes(jsonProject.selectedFormat), jsonProject.selectedFormat);
    check('.json : 5 pistes / 7 clips', jsonProject.tracks.length === 5 && jsonProject.tracks.reduce((s, t) => s + t.clips.length, 0) === 7);
    const imgClip = jsonProject.tracks.flatMap(t => t.clips).find(c => c.type === 'image');
    check('.json : Infinity survit (sourceDuration image)', imgClip && imgClip.sourceDuration === Infinity, imgClip ? String(imgClip.sourceDuration) : 'pas de clip image');
    const textClip = jsonProject.tracks.flatMap(t => t.clips).find(c => c.type === 'text');
    check('.json : style du texte complet', !!(textClip && textClip.style && textClip.style.shadowEnabled === true && textClip.style.fontSize === '140px'));

    // Format que les projets DOIVENT restaurer (celui du dernier export lancé).
    const SAVED_FORMAT = jsonProject.selectedFormat;

    // ── Rechargement de page + rechargement des projets ─────────────────
    console.log('\n▶ Rechargement de la page, puis ouverture des deux projets…');
    const reloadAndLoad = async (which) => {
      // ⚠️ On EFFACE volontairement le format mémorisé en localStorage avant de
      // recharger : sans cela la page repartirait déjà sur « mp3 » et le test ne
      // prouverait rien (il validerait le localStorage, pas le fichier de projet).
      await cdp.eval(`(() => { try { localStorage.removeItem('ctf_export_format'); } catch (_) {} return true; })()`).catch(() => {});
      await cdp.send('Page.reload', { ignoreCache: false });
      await sleep(6000);
      await cdp.send('Runtime.disable').catch(() => {});
      await cdp.send('Runtime.enable');
      for (let i = 0; i < 60; i++) { if (await cdp.eval('typeof window.app !== "undefined" && !!window.app.tracks').catch(() => false)) break; await sleep(500); }
      return cdp.eval(`(async () => {
        app.selectExportFormat('mp3');   // valeur volontairement différente pour vérifier la restauration
        const b = await (await fetch('/tools/regression/out/${which === 'ctf' ? 'project.ctf' : 'project.json'}')).blob();
        const file = new File([b], '${which === 'ctf' ? 'project.ctf' : 'project.json'}', { type: 'application/octet-stream' });
        await app.${which === 'ctf' ? 'loadCtfProject' : 'loadJsonProject'}(file);
        await new Promise(r => setTimeout(r, 800));
        return {
          projectName: app.projectName,
          selectedFormat: app.selectedFormat,
          selectedResolution: app.selectedResolution,
          selectedFps: app.selectedFps,
          tracks: app.tracks.length,
          clips: app.tracks.reduce((s, t) => s + t.clips.length, 0),
          detail: app.tracks.map(t => t.name + ':' + t.clips.map(c => c.type).join('+')).join(' | '),
          media: app.mediaLibrary.length,
          mediaWithUrl: app.mediaLibrary.filter(m => m.url).length
        };
      })()`, true);
    };

    const afterCtf = await reloadAndLoad('ctf');
    console.log('   .ctf → ' + JSON.stringify(afterCtf));
    report.reloadCtf = afterCtf;
    check('.ctf : 5 pistes / 7 clips restaurés', afterCtf.tracks === 5 && afterCtf.clips === 7, `tracks=${afterCtf.tracks} clips=${afterCtf.clips}`);
    // ⚠️ On compare au format RÉELLEMENT enregistré dans le projet (le dernier
    // export lancé était le MP3, donc le projet dit « mp3 »), et non à « mp4 »
    // en dur : le 1ᵉʳ jet du banc affichait « ❌ mp3 » pour une valeur correcte.
    check('.ctf : format d\'export restauré', afterCtf.selectedFormat === SAVED_FORMAT, `enregistré « ${SAVED_FORMAT} », relu « ${afterCtf.selectedFormat} »`);
    check('.ctf : médias reliés', afterCtf.mediaWithUrl === afterCtf.media && afterCtf.media === 5, `${afterCtf.mediaWithUrl}/${afterCtf.media}`);

    const afterJson = await reloadAndLoad('json');
    console.log('   .json → ' + JSON.stringify(afterJson));
    report.reloadJson = afterJson;
    check('.json : 5 pistes / 7 clips restaurés', afterJson.tracks === 5 && afterJson.clips === 7, `tracks=${afterJson.tracks} clips=${afterJson.clips}`);
    check('.json : format d\'export restauré', afterJson.selectedFormat === SAVED_FORMAT, `enregistré « ${SAVED_FORMAT} », relu « ${afterJson.selectedFormat} »`);

    // ── Analyse des fichiers exportés ───────────────────────────────────
    console.log('\n══════════════ ANALYSE FFMPEG ══════════════');
    const mp4 = path.join(OUT, 'export.mp4');
    if (!fs.existsSync(mp4)) throw new Error('export.mp4 manquant');
    const s = probe(mp4, ['-show_entries', 'stream=codec_name,codec_type,width,height,sample_rate,channels']);
    const vS = (s.streams || []).find(x => x.codec_type === 'video');
    const aS = (s.streams || []).find(x => x.codec_type === 'audio');
    const nbFrames = (() => {
      const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', mp4], { encoding: 'utf8' });
      return parseInt(String(r.stdout).trim(), 10);
    })();
    console.log(`MP4  : ${vS.codec_name} ${vS.width}x${vS.height} + ${aS.codec_name} ${aS.sample_rate}Hz ${aS.channels}ch · ${nbFrames} images`);
    check('MP4 : 390 images (13 s à 30 fps)', nbFrames === EXPECTED.frames, nbFrames + ' images');

    const pcm = decodePcm(mp4);
    console.log(`Audio : ${(pcm.length / 48000).toFixed(3)} s`);
    check('MP4 : durée audio ≈ 13 s', Math.abs(pcm.length / 48000 - EXPECTED.duration) < 0.05, (pcm.length / 48000).toFixed(3) + ' s');

    // ── Repères audio, mesurés PAR FRÉQUENCE (voir freqRanges) ─────────────
    // 880 Hz : a.mp4, 2 → 4 s · 1500 Hz : beep.wav, 6 → 9 s (premier plan)
    // 1200 Hz : b.mp4, 9 → 13 s. Le 300 Hz (musique) est continu : inutilisable
    // comme repère, mais il ne gêne plus la mesure des autres.
    const REPERES = [
      { f: 880, label: 'a.mp4 (880 Hz) 2 → 4 s', start: 2.0, end: 4.0 },
      { f: 1500, label: 'beep.wav (1500 Hz) 6 → 9 s', start: 6.0, end: 9.0 },
      { f: 1200, label: 'b.mp4 (1200 Hz) début 9 s', start: 9.0, end: null },
    ];
    const measureAudio = (file, tag) => {
      const smp = tag === 'MP4' ? pcm : decodePcm(file);
      const out = {};
      for (const r of REPERES) {
        const { ranges } = freqRanges(smp, 48000, r.f);
        // la plage la plus longue = le vrai repère (une fuite spectrale est brève)
        const best = ranges.slice().sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] || null;
        out[r.f] = best;
      }
      return out;
    };
    const rep = measureAudio(mp4, 'MP4');
    const tolerance = 0.04; // ±40 ms
    const msErr = (measured, expected) => (measured === null ? null : +((measured - expected) * 1000).toFixed(0));
    for (const r of REPERES) {
      const got = rep[r.f];
      const dStart = msErr(got ? got[0] : null, r.start);
      const dEnd = r.end === null ? null : msErr(got ? got[1] : null, r.end);
      console.log(`MP4 : ${r.label} → plage mesurée ${got ? JSON.stringify(got) : 'ABSENTE'}` +
                  ` · début ${dStart === null ? 'n/a' : dStart + ' ms'}` +
                  (dEnd === null ? '' : ` · fin ${dEnd} ms`));
      check(`MP4 : ${r.label} — début à ±40 ms`,
        got !== null && Math.abs(dStart) <= tolerance * 1000,
        got ? `${got[0]} s (écart ${dStart} ms)` : 'fréquence absente');
      if (r.end !== null) {
        check(`MP4 : ${r.label} — fin à ±40 ms`,
          got !== null && Math.abs(dEnd) <= tolerance * 1000,
          got ? `${got[1]} s (écart ${dEnd} ms)` : 'fréquence absente');
      }
    }
    report.mp4Audio = rep;

    /**
 * Série de luminances moyennes, une valeur (0-255) par image.
 *
 * ⚠️ Mesure fiable pour comparer un export à sa SOURCE : on réduit chaque image à
 * 1×1 pixel en niveaux de gris (`scale=1:1,format=gray`), donc la recompression
 * H.264 ne peut pas fausser la comparaison. Ne PAS essayer de coder le numéro
 * d'image dans la luminance : la compression + la gamme limitée le rendent
 * illisible (test essayé, chiffres incohérents).
 */
const meanLumaSeries = (file, seconds) => {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-t', String(seconds), '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
  if (!r.stdout || !r.stdout.length) return [];
  return Array.from(r.stdout);
};

const lumas = {};
    for (const t of [5.90, 5.97, 6.00, 6.03, 6.10, 8.90, 8.97, 9.00, 9.03, 9.10]) lumas[t] = lumaAt(mp4, t);
    console.log('Luminance aux coupes : ' + JSON.stringify(lumas));
    const minLuma = Math.min(...Object.values(lumas).filter(v => v !== null));
    check('MP4 : aucune image noire aux coupes', minLuma >= 20, 'luminance min = ' + minLuma + '/255');

    // Calques : la forme bleue (10-50 % en X, 55-95 % en Y) doit teinter la zone où
    // elle se trouve, et SEULEMENT pendant 6,5-8,5 s. On compare la MÊME zone à
    // 7,5 s (calques affichés) et à 6,1 s / 8,9 s (image magenta seule) : fond
    // identique dans les trois cas, donc la comparaison est déterministe.
    const BLOCK_CROP = 'iw*0.4:ih*0.4:iw*0.10:ih*0.55';
    const zone = (t) => rgbAt(mp4, t, BLOCK_CROP);
    const zOff1 = zone(6.1), zOn = zone(7.5), zOff2 = zone(8.9);
    console.log(`Zone de la forme : t=6,1 ${JSON.stringify(zOff1)} · t=7,5 ${JSON.stringify(zOn)} · t=8,9 ${JSON.stringify(zOff2)}`);
    report.mp4Colors = { zoneOff1: zOff1, zoneOn: zOn, zoneOff2: zOff2 };
    const blueOn = zOn ? zOn[2] - zOn[0] : 0;
    const blueOff1 = zOff1 ? zOff1[2] - zOff1[0] : 0;
    const blueOff2 = zOff2 ? zOff2[2] - zOff2[0] : 0;
    check('MP4 : la forme bleue est VISIBLE pendant 6,5-8,5 s', blueOn > blueOff1 + 25 && blueOn > blueOff2 + 25, `bleu-rouge : ${blueOn} (actif) vs ${blueOff1} / ${blueOff2} (inactif)`);

    // Texte : le TITRE est blanc pur, centré. On regarde la luminance MAXIMALE de la
    // bande centrale — et non la moyenne de l'image entière, qui baisse dès que la
    // forme bleue (opacité 0,8, sombre) s'affiche en même temps : la moyenne
    // comparait alors « texte + forme bleue » à « magenta seul » et ne prouvait rien.
    const TITLE_CROP = 'iw*0.8:ih*0.3:iw*0.1:ih*0.35';
    const lmaxOn = maxLumaAt(mp4, 7.5, TITLE_CROP);
    const lmaxOff = maxLumaAt(mp4, 6.1, TITLE_CROP);
    console.log(`Luminance MAX au centre : t=7,5 (titre) ${lmaxOn}/255 · t=6,1 (sans) ${lmaxOff}/255`);
    report.textLuma = { withText: lmaxOn, withoutText: lmaxOff };
    check('MP4 : le texte blanc est affiché (blanc pur au centre à 7,5 s)',
      lmaxOn !== null && lmaxOn > 200 && (lmaxOff === null || lmaxOff < 200),
      `${lmaxOn}/255 (avec) vs ${lmaxOff}/255 (sans)`);

    const c7 = rgbAt(mp4, 7.0);
    check('MP4 : l\'image magenta est bien affichée (6-9 s)', c7 && c7[0] > 120 && c7[0] > c7[1] + 40, JSON.stringify(c7));

    // ── Fidélité : les images de la 1ʳᵉ séquence (a.mp4, 0-6 s) doivent être
    //    identiques à la SOURCE, image par image. Aucun overlay n'est présent
    //    avant 6,5 s, donc toute différence vient du décodage/rendu. C'est la
    //    vérification la plus forte du banc : elle prouve qu'aucune image n'est
    //    décalée, dupliquée, noire ou tirée d'un autre instant de la timeline.
    const srcSeries = meanLumaSeries(path.join(MEDIA, 'a.mp4'), 5.9);
    const outSeries = meanLumaSeries(mp4, 5.9);
    const compareLen = Math.min(srcSeries.length, outSeries.length);
    let maxDiff = 0, diffCount = 0;
    for (let i = 0; i < compareLen; i++) {
      const d = Math.abs(srcSeries[i] - outSeries[i]);
      if (d > maxDiff) maxDiff = d;
      if (d > 2) diffCount++;
    }
    console.log(`Fidélité MP4 vs a.mp4 : ${compareLen} images comparées · écart max ${maxDiff}/255 sur ${diffCount} image(s)`);
    report.fidelity = { compared: compareLen, maxDiff, diffCount };
    check('MP4 : séquence identique à la source (écart ≤ 2/255)',
      compareLen > 150 && diffCount === 0,
      `${diffCount} image(s) différente(s) sur ${compareLen} (écart max ${maxDiff}/255)`);

    // ── WEBM / MP3 ──────────────────────────────────────────────────────
    const webm = path.join(OUT, 'export.webm');
    if (fs.existsSync(webm)) {
      const s2 = probe(webm, ['-show_entries', 'stream=codec_name,codec_type,width,height,sample_rate']);
      const wV = (s2.streams || []).find(x => x.codec_type === 'video'), wA = (s2.streams || []).find(x => x.codec_type === 'audio');
      const wFrames = (() => {
        const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', webm], { encoding: 'utf8' });
        return parseInt(String(r.stdout).trim(), 10);
      })();
      const wRep = measureAudio(webm, 'WEBM');
      console.log(`\nWEBM : ${wV.codec_name} ${wV.width}x${wV.height} + ${wA.codec_name} ${wA.sample_rate}Hz · ${wFrames} images`);
      report.webm = { video: wV.codec_name, audio: wA.codec_name, frames: wFrames, repères: wRep };
      check('WEBM : 390 images', wFrames === EXPECTED.frames, wFrames + ' images');
      const wDiff = REPERES.map((r) => {
        const a = rep[r.f], b = wRep[r.f];
        if (!a || !b) return null;
        return +((b[0] - a[0]) * 1000).toFixed(0);
      });
      console.log(`       écart de synchro WEBM − MP4 (ms) : ${JSON.stringify(wDiff)}`);
      check('WEBM : synchro audio identique au MP4 (±20 ms)',
        wDiff.every((d) => d !== null && Math.abs(d) <= 20), JSON.stringify(wDiff) + ' ms');
    }

    const mp3 = path.join(OUT, 'export.mp3');
    if (fs.existsSync(mp3)) {
      const s3 = probe(mp3, ['-show_entries', 'stream=codec_name,sample_rate,channels', '-show_entries', 'format=duration,format_name']);
      const mRep = measureAudio(mp3, 'MP3');
      console.log(`\nMP3  : ${s3.streams?.[0]?.codec_name} ${s3.streams?.[0]?.sample_rate}Hz · ${(+s3.format?.duration || 0).toFixed(3)} s`);
      report.mp3 = { codec: s3.streams?.[0]?.codec_name, duration: +(+(s3.format?.duration || 0)).toFixed(3), repères: mRep };
      check('MP3 : vrai MP3 décodable', s3.streams?.[0]?.codec_name === 'mp3', s3.streams?.[0]?.codec_name);
      const mDiff = REPERES.map((r) => {
        const a = rep[r.f], b = mRep[r.f];
        if (!a || !b) return null;
        return +((b[0] - a[0]) * 1000).toFixed(0);
      });
      console.log(`       écart de synchro MP3 − MP4 (ms) : ${JSON.stringify(mDiff)}`);
      check('MP3 : aligné sur le MP4 (±20 ms)',
        mDiff.every((d) => d !== null && Math.abs(d) <= 20), JSON.stringify(mDiff) + ' ms');
    }

    // ── Bilan ───────────────────────────────────────────────────────────
    console.log('\n══════════════ BILAN ══════════════');
    const failed = checks.filter(c => !c.ok);
    console.log(`${checks.length - failed.length}/${checks.length} vérifications réussies`);
    if (failed.length) failed.forEach(c => console.log('   ❌ ' + c.name + ' — ' + c.detail));
    report.checks = checks;
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log('\n=> ' + path.join(OUT, 'report.json'));
    process.exitCode = failed.length ? 1 : 0;
  } catch (e) {
    console.error('\nERREUR: ' + e.message);
    process.exitCode = 2;
  } finally {
    killChrome();
    try { srv.kill(); } catch {}
  }
  setTimeout(() => process.exit(process.exitCode || 0), 300);
})();
