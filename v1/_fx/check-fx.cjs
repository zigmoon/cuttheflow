/**
 * Vérifie dans un export MP4 que le FADE et le FX sont corrects :
 *  - fade in : luminance moyenne croissante sur la 1re seconde (vers le noir)
 *  - fade out : luminance moyenne décroissante sur la dernière seconde
 *  - FX pixelate : l'image doit être "bloc" (peu de valeurs distinctes / faible
 *    énergie en haute fréquence) comparée à la source non filtrée.
 *
 * Usage : node check-fx.cjs <export.mp4> [source.mp4]
 */
'use strict';
const { spawnSync } = require('child_process');

const file = process.argv[2];
const src = process.argv[3];
const W = 64, H = 36;

/** Décode N images réduites et renvoie leur luminance moyenne dans [0,1]. */
function lumaSeries(f, t0, t1, n) {
    const r = spawnSync('ffmpeg', ['-v', 'error',
        '-ss', String(t0), '-t', String(t1 - t0), '-i', f,
        '-vf', `fps=${n / (t1 - t0)},scale=${W}:${H}`,
        '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
        { maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || '').toString().slice(0, 300));
    const buf = r.stdout;
    const nf = Math.floor(buf.length / (W * H));
    const out = [];
    for (let i = 0; i < nf; i++) {
        let s = 0;
        for (let k = 0; k < W * H; k++) s += buf[i * W * H + k];
        out.push(s / (W * H * 255));
    }
    return out;
}

/** Écart-type spatial normalisé : mesure le "bloc-ness" de l'image. */
function detailSeries(f, t0, t1, n) {
    const r = spawnSync('ffmpeg', ['-v', 'error',
        '-ss', String(t0), '-t', String(t1 - t0), '-i', f,
        '-vf', `fps=${n / (t1 - t0)},scale=${W}:${H}`,
        '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
        { maxBuffer: 64 * 1024 * 1024 });
    const buf = r.stdout;
    const nf = Math.floor(buf.length / (W * H));
    const out = [];
    for (let i = 0; i < nf; i++) {
        const base = i * W * H;
        let sumGrad = 0, count = 0;
        for (let y = 1; y < H; y++) {
            for (let x = 1; x < W; x++) {
                const c = buf[base + y * W + x];
                sumGrad += Math.abs(c - buf[base + y * W + x - 1]) + Math.abs(c - buf[base + (y - 1) * W + x]);
                count += 2;
            }
        }
        out.push(count ? sumGrad / count : 0);
    }
    return out;
}

const dur = Number((spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout || '0').trim());
console.log(`Fichier : ${file}`);
console.log(`Durée   : ${dur.toFixed(3)} s\n`);

// ── FADE IN (0 → 1 s attendu : noir → image) ────────────────────────────────
console.log('— FADE IN (image attendue NOIRE puis croissante sur 0→1 s) —');
const fadeIn = lumaSeries(file, 0, 1.2, 12);
fadeIn.forEach((v, i) => {
    const t = (i / 12 * 1.2).toFixed(2);
    const bar = '█'.repeat(Math.round(v * 40));
    console.log(`  t=${String(t).padStart(5)}s  luma=${v.toFixed(3)}  ${bar}`);
});
const firstLuma = fadeIn[0], lastLuma = fadeIn[fadeIn.length - 1];
const monotone = fadeIn.every((v, i) => i === 0 || v >= fadeIn[i - 1] - 0.02);
console.log(`\n  luma départ=${firstLuma.toFixed(3)} → fin=${lastLuma.toFixed(3)}`);
console.log(`  ${firstLuma < 0.06 ? '✅' : '❌'} démarre au noir (fondu entrant effectif)`);
console.log(`  ${monotone ? '✅' : '❌'} progression croissante (pas de saut)`);

// ── FADE OUT (dernière seconde : image → noir) ─────────────────────────────
console.log('\n— FADE OUT (image attendue décroissante vers NOIR sur la dernière seconde) —');
const fadeOut = lumaSeries(file, Math.max(0, dur - 1.2), dur, 12);
fadeOut.forEach((v, i) => {
    const t = (dur - 1.2 + i / 12 * 1.2).toFixed(2);
    const bar = '█'.repeat(Math.round(v * 40));
    console.log(`  t=${String(t).padStart(5)}s  luma=${v.toFixed(3)}  ${bar}`);
});
const foEnd = fadeOut[fadeOut.length - 1], foStart = fadeOut[0];
const monoDown = fadeOut.every((v, i) => i === 0 || v <= fadeOut[i - 1] + 0.02);
console.log(`\n  luma départ=${foStart.toFixed(3)} → fin=${foEnd.toFixed(3)}`);
console.log(`  ${foEnd < 0.06 ? '✅' : '❌'} finit au noir (fondu sortant effectif)`);
console.log(`  ${monoDown ? '✅' : '❌'} progression décroissante`);

// ── FX (effet appliqué au milieu du clip, hors fades) ──────────────────────
console.log('\n— EFFECT VISIBLE (mesure de détail spatial au milieu du clip) —');
const midA = Math.round(dur / 2 * 10) / 10;
const midB = midA + 0.8;
const dExport = detailSeries(file, midA, midB, 6);
const dExportAvg = dExport.reduce((a, b) => a + b, 0) / dExport.length;
console.log(`  détail spatial export (milieu) = ${dExportAvg.toFixed(2)}`);

if (src) {
    const dSrc = detailSeries(src, midA, midB, 6);
    const dSrcAvg = dSrc.reduce((a, b) => a + b, 0) / dSrc.length;
    console.log(`  détail spatial SOURCE (milieu) = ${dSrcAvg.toFixed(2)}`);
    console.log(`  ratio source/export = ${(dSrcAvg / Math.max(dExportAvg, 0.01)).toFixed(2)}x`);
    console.log(`  ${dExportAvg < dSrcAvg * 0.75 ? '✅ effet visible (image nettement simplifiée)' : '❌ effet NON visible'}`);
}

// ── Saturation temporelle : un FX animé doit varier d'une frame à l'autre ──
console.log('\n— VARIATION TEMPORELLE (le FX doit changer entre les images) —');
const s1 = lumaSeries(file, midA, midB, 6);
let diff = 0;
for (let i = 1; i < s1.length; i++) diff += Math.abs(s1[i] - s1[i - 1]);
console.log(`  variation cumulée = ${diff.toFixed(4)} ${diff > 0.0001 ? '✅ (images différentes)' : '⚠️ (images identiques)'}`);
