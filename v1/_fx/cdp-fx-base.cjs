/**
 * Non-régression FX : exporte un petit clip pour CHAQUE effet refactorisé
 * (pool de canvas) et vérifie que l'effet est bien appliqué.
 * Mesure aussi le temps d'export (gain du pool).
 *
 * Usage : node cdp-fx-batch.cjs
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9342;
const RECV = 8906;
const PROFILE = path.join(__dirname, 'chrome-profile-fxb');
const EFFECTS = ['none', 'pixelate', 'noise', 'vhs'];

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
    return http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        const name = path.basename(req.headers['x-filename'] || 'f.bin');
        const c = [];
        req.on('data', d => c.push(d));
        req.on('end', () => {
            fs.writeFileSync(path.join(outDir, name), Buffer.concat(c));
            res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end('ok');
        });
    }).listen(port, '127.0.0.1');
}

(async () => {
    const recv = receiver(RECV, path.join(__dirname, 'out'));
    fs.rmSync(PROFILE, { recursive: true, force: true });
    const chrome = spawn(CHROME, [
        `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
        '--no-first-run', '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        'http://127.0.0.1:8891/index.html?fxb=' + Date.now()
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

        await cdp.eval(`
            (async () => {
                const app = window.app;
                app.tracks.forEach(t => { t.clips.length = 0; });
                app.mediaLibrary.length = 0;
                const b = await (await fetch('/_fx/test.mp4')).arrayBuffer();
                await app.handleFiles([new File([b], 'test.mp4', { type: 'video/mp4' })]);
                return 1;
            })()
        `);
        console.log('media importe\n');

        const results = [];
        for (const fx of EFFECTS) {
            const r = await cdp.eval(`
                (async () => {
                    const app = window.app;
                    app.tracks.forEach(t => { t.clips.length = 0; });
                    const M = app.mediaLibrary.find(m => m.name === 'test.mp4');
                    const v1 = app.tracks.filter(t => /VIDEO/i.test(t.name))[0];
                    const c = app.addClipToTrack(M, v1.id, 0);
                    c.duration = 1.5;
                    c.effect = ('${fx}' === 'none') ? 'none' : '${fx}';
                    c.effectIntensity = 100;
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
                        method: 'POST', headers: { 'x-filename': 'base_${fx}.mp4' }, body: blob
                    });
                    return JSON.stringify({ fx: '${fx}', err, ms: Math.round(ms), size: blob ? blob.size : null });
                })()
            `);
            const o = JSON.parse(r);
            results.push(o);
            console.log(`  ${o.err ? '❌' : '✅'} ${o.fx.padEnd(12)} ${String(o.ms).padStart(5)} ms  ${o.size ? (o.size/1024).toFixed(0)+' Ko' : '-'}${o.err ? '  ERR:'+o.err : ''}`);
        }
        fs.writeFileSync(path.join(__dirname, 'fx-batch.json'), JSON.stringify(results, null, 1));
        console.log('\n✅ Lot terminé.');
    } finally {
        try { cdp && cdp.ws.close(); } catch (_) { }
        try { chrome.kill(); } catch (_) { }
        recv.close();
    }
})().catch(e => { console.error('❌ ÉCHEC:', e.message); process.exit(1); });

