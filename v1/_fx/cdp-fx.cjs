/**
 * Validation Chrome réelle des correctifs v3.9.9 :
 *   1. Zoom/dézoom : les numéros du ruler restent-ils ALIGNÉS avec les clips ?
 *   2. Export MP4 avec FX + fade : durée, frames, opacité, effet visible ?
 *
 * Usage : node cdp-fx.cjs
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const RECV = 8905;
const PROFILE = path.join(__dirname, 'chrome-profile-fx');

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
        this.ws = ws; this.id = 0; this.pending = new Map();
        ws.addEventListener('message', ev => {
            let m; try { m = JSON.parse(ev.data); } catch { return; }
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
            setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 1800000);
        });
    }
    async eval(expr, tries = 4) {
        for (let i = 1; i <= tries; i++) {
            try {
                const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
                if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
                return r.result.value;
            } catch (e) { if (i === tries) throw e; await new Promise(r => setTimeout(r, 1500)); }
        }
    }
}

function receiver(port, outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const s = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        const name = path.basename(req.headers['x-filename'] || 'f.bin');
        const c = [];
        req.on('data', d => c.push(d));
        req.on('end', () => {
            fs.writeFileSync(path.join(outDir, name), Buffer.concat(c));
            console.log(`   📥 ${name} (${fs.statSync(path.join(outDir, name)).size} octets)`);
            res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok');
        });
    });
    s.listen(port, '127.0.0.1');
    return s;
}

(async () => {
    const recv = receiver(RECV, path.join(__dirname, 'out'));
    fs.rmSync(PROFILE, { recursive: true, force: true });
    const chrome = spawn(CHROME, [
        `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
        '--no-first-run', '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        'http://127.0.0.1:8891/index.html?fx=' + Date.now()
    ], { stdio: 'ignore' });

    let cdp;
    try {
        let page = null;
        for (let i = 0; i < 40 && !page; i++) {
            try {
                const list = await new Promise((res, rej) => {
                    const r = http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' }, x => {
                        let d = ''; x.on('data', c => d += c);
                        x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
                    }); r.on('error', rej);
                });
                page = list.find(t => t.type === 'page' && /8891/.test(t.url));
            } catch { }
            if (!page) await new Promise(r => setTimeout(r, 500));
        }
        if (!page) throw new Error('page introuvable');

        cdp = await CDP.connect(page.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        console.log('✅ ' + (await cdp.eval('navigator.userAgent')).match(/Chrome\/[\d.]+/)[0]);
        await cdp.eval(`(async()=>{for(let i=0;i<80;i++){if(window.app&&window.startWebCodecsExport)return 1;await new Promise(r=>setTimeout(r,250));}return 0;})()`);
        await cdp.eval(`(()=>{const k=()=>document.querySelectorAll('.donate-popup,.popup-overlay,.modal-overlay,.save-reminder').forEach(e=>e.remove());k();setTimeout(k,400);setTimeout(k,1200);return 1;})()`);

        // Import d'une vidéo de test (nécessaire pour avoir un média et un clip)
        console.log('\n▶ Import du média de test…');
        const imported = await cdp.eval(`
            (async () => {
                const app = window.app;
                app.tracks.forEach(t => { t.clips.length = 0; });
                app.mediaLibrary.length = 0;
                const b = await (await fetch('/_fx/test.mp4')).arrayBuffer();
                await app.handleFiles([new File([b], 'test.mp4', { type: 'video/mp4' })]);
                const m = app.mediaLibrary.find(x => x.name === 'test.mp4');
                return JSON.stringify(m ? { id: m.id, dur: +m.duration.toFixed(2), w: m.width, h: m.height } : { err: 'import rate' });
            })()
        `);
        console.log('   ' + imported);

        // ─── 1. TEST ZOOM / RULER ───────────────────────────────────────
        console.log('\n▶ TEST 1 — zoom/dézoom : alignement des numéros du ruler');
        const zoomTest = await cdp.eval(`
            (async () => {
                const app = window.app;
                const content = document.getElementById('rulerContent');
                const marks = document.getElementById('rulerMarks');
                const tl = document.getElementById('timelineScroll');
                const out = { checks: [] };

                // Timeline de 5 min pour avoir de la marge
                const M = app.mediaLibrary[0];
                app.tracks.forEach(t => { t.clips.length = 0; });
                const c = app.addClipToTrack(M, app.tracks[0].id, 0);
                c.duration = 300;
                app.zoomLevel = 50;
                app.renderTracks();

                // On se place loin dans la timeline puis on zoome/dézoome
                tl.scrollLeft = 3000; tl.dispatchEvent(new Event('scroll'));
                await new Promise(r => setTimeout(r, 60));

                const verify = (tag) => {
                    const labels = [...marks.querySelectorAll('.ruler-time')];
                    const cr = content.getBoundingClientRect();
                    // Position logique du label = sa position écran + scroll réel des pistes
                    let maxErr = 0, worst = null;
                    for (const e of labels) {
                        const t = e.textContent;
                        const [m, s] = t.split(':').map(Number);
                        const expectedTime = m * 60 + s;
                        const expectedLogicalX = expectedTime * app.zoomLevel;   // dans le repère des pistes
                        // déduire la position logique depuis le rendu écran :
                        const screenX = e.getBoundingClientRect().left - cr.left;
                        const logicalX = screenX + tl.scrollLeft;                // ce que "voit" l'utilisateur
                        const err = Math.abs(logicalX - expectedLogicalX);
                        if (err > maxErr) { maxErr = err; worst = t; }
                    }
                    out.checks.push({
                        tag, zoom: +app.zoomLevel.toFixed(2),
                        tlScroll: Math.round(tl.scrollLeft),
                        transform: marks.style.transform || '(none)',
                        maxErreurPx: Math.round(maxErr), pireLabel: worst,
                        aligne: maxErr < 1.5
                    });
                };

                verify('initial z50 scroll3000');
                for (let i = 0; i < 10; i++) { app.zoomOut(); await new Promise(r => setTimeout(r, 25)); }
                tl.dispatchEvent(new Event('scroll'));
                await new Promise(r => setTimeout(r, 60));
                verify('apres 10 zoomOut');
                for (let i = 0; i < 6; i++) { app.zoomIn(); await new Promise(r => setTimeout(r, 25)); }
                tl.dispatchEvent(new Event('scroll'));
                await new Promise(r => setTimeout(r, 60));
                verify('apres 6 zoomIn');
                // Aller tout au fond
                tl.scrollLeft = 999999; tl.dispatchEvent(new Event('scroll'));
                await new Promise(r => setTimeout(r, 80));
                verify('scroll max (fond)');
                out.toutAligne = out.checks.every(x => x.aligne);
                return JSON.stringify(out);
            })()
        `);
        console.log('   ' + zoomTest);

        // ─── 2. EXPORT AVEC FX + FADE ───────────────────────────────────
        console.log('\n▶ TEST 2 — export MP4 avec FX (pixelate) + fade in/out');
        const fxExport = await cdp.eval(`
            (async () => {
                const app = window.app;
                app.tracks.forEach(t => { t.clips.length = 0; });
                const M = app.mediaLibrary[0];
                const v1 = app.tracks.filter(t => /VIDEO/i.test(t.name))[0];
                const c = app.addClipToTrack(M, v1.id, 0);
                c.duration = 4;
                c.effect = 'pixelate';
                c.effectIntensity = 100;
                c.fadeIn = 1;     // fondu au noir sur la 1re seconde
                c.fadeOut = 1;    // fondu sur la derniere seconde
                c.audioMuted = true;

                app._invalidateTimelineEndCache && app._invalidateTimelineEndCache();
                app.closeExportModal && app.closeExportModal();
                app.selectedResolution = '1280x720';
                app.selectedFps = 30;
                app.selectedFormat = 'mp4';
                let err = null;
                const t0 = performance.now();
                try { await startWebCodecsExport(app); } catch (e) { err = String(e && e.message || e); }
                const ms = performance.now() - t0;
                const blob = app.exportedVideoBlob;
                if (blob) await fetch('http://127.0.0.1:${RECV}/up', {
                    method: 'POST', headers: { 'x-filename': 'fx_fade.mp4' }, body: blob
                });
                return JSON.stringify({
                    err, sec: +(ms / 1000).toFixed(1),
                    size: blob ? blob.size : null,
                    clip: { fx: c.effect, intensity: c.effectIntensity, fadeIn: c.fadeIn, fadeOut: c.fadeOut, dur: c.duration }
                });
            })()
        `);
        console.log('   ' + fxExport);
        console.log('\n✅ Terminé.');
    } finally {
        try { cdp && cdp.ws.close(); } catch (_) { }
        try { chrome.kill(); } catch (_) { }
        recv.close();
    }
})().catch(e => { console.error('❌ ÉCHEC:', e.message); process.exit(1); });
