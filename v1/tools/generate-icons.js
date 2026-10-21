// Generate PWA icons from the CUT THE FLOW master SVG.
// Extracts the visible CUT_THE_FLOW_-_blanc group and rasterises it into
// 192/512/512-maskable/180 (apple-touch) PNGs with a dark theme background
// matching manifest.json's theme_color (#1a1a1a).
//
// Run: node tools/generate-icons.js   (from CUTTHEFLOW/)

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'img', 'CUT_THE_FLOW_b.svg');
const outDir = path.join(root, 'img');

const raw = fs.readFileSync(svgPath, 'utf8');

// Pull out the only group that is NOT display="none" — the CUT THE FLOW logo.
const m = raw.match(
    /<g id="CUT_x5F_THE_x5F_FLOW_-_blanc"[^>]*>([\s\S]*?)<\/g>\s*<g id="CHESS/
);
if (!m) {
    console.error('CUT THE FLOW group not found in master SVG');
    process.exit(1);
}
const inner = m[1];

const BG = '#1a1a1a'; // matches manifest.json theme_color

const fullSvg = (bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600"><rect width="600" height="600" fill="${bg}"/><g>${inner}</g></svg>`;

// Maskable: shrink logo to 70% so it sits inside Android's safe area.
const maskableSvg = (bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600"><rect width="600" height="600" fill="${bg}"/><g transform="translate(90 90) scale(0.7)">${inner}</g></svg>`;

(async () => {
    await sharp(Buffer.from(fullSvg(BG))).resize(192, 192).png().toFile(path.join(outDir, 'icon-192.png'));
    await sharp(Buffer.from(fullSvg(BG))).resize(512, 512).png().toFile(path.join(outDir, 'icon-512.png'));
    await sharp(Buffer.from(maskableSvg(BG))).resize(512, 512).png().toFile(path.join(outDir, 'icon-512-maskable.png'));
    await sharp(Buffer.from(fullSvg(BG))).resize(180, 180).png().toFile(path.join(outDir, 'apple-touch-icon.png'));
    console.log('PWA icons regenerated from CUT_THE_FLOW logo:');
    for (const f of ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png']) {
        const sz = fs.statSync(path.join(outDir, f)).size;
        console.log(`  img/${f}  (${sz} bytes)`);
    }
})();
