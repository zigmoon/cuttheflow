/**
 * Test DÉCISIF : l'effet est-il réellement appliqué dans l'export ?
 * On compare, image par image, l'export à la SOURCE (même instant, même
 * résolution). Si un FX est appliqué, les images doivent différer largement.
 * On mesure aussi la "platitude" (proportion de pixels voisins identiques) :
 * un effet de pixelisation la fait exploser.
 *
 * Usage : node diff-fx.cjs <export.mp4> <source.mp4> <t>
 */
'use strict';
const { spawnSync } = require('child_process');

const [, , exported, source, tStr] = process.argv;
const t = Number(tStr || 2.0);
const W = 320, H = 180;

function gray(f, time) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', f,
        '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
        { maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) throw new Error('ffmpeg ' + f + ': ' + (r.stderr || '').toString().slice(0, 200));
    return r.stdout;
}

/** Proportion de pixels voisins quasi identiques (mesure la "bloc-ness"). */
function flatness(buf) {
    let flat = 0, total = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 1; x < W; x++) {
            if (Math.abs(buf[y * W + x] - buf[y * W + x - 1]) <= 2) flat++;
            total++;
        }
    }
    return flat / total;
}

const a = gray(exported, t);
const b = gray(source, t);
const n = Math.min(a.length, b.length);

let sum = 0, big = 0;
for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    if (d > 24) big++;
}
const mad = sum / n;
const pctBig = (big / n) * 100;

console.log(`t = ${t} s   (${W}x${H} gray)\n`);
console.log(`Écart moyen export vs source : ${mad.toFixed(2)} / 255`);
console.log(`Pixels très différents (>24) : ${pctBig.toFixed(1)} %`);
console.log('');
console.log(`platitude EXPORT : ${(flatness(a) * 100).toFixed(1)} %`);
console.log(`platitude SOURCE : ${(flatness(b) * 100).toFixed(1)} %`);
console.log('');
if (mad > 6 || pctBig > 12) {
    console.log('✅ L\'EFFET EST APPLIQUÉ dans l\'export (images nettement différentes de la source)');
} else {
    console.log('❌ L\'EFFET SEMBLE ABSENT (export quasi identique à la source)');
}
if (flatness(a) > flatness(b) * 1.5) {
    console.log('✅ signature de pixelisation détectée (image plus "plate" que la source)');
}
