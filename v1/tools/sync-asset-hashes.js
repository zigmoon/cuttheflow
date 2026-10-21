const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const assets = [
    'css/style.css',
    'css/fonts-core-local.css',
    'css/fonts-editor-local.css',
    'vendor/jszip.min.js',
    'vendor/mp4box.all.min.js',
    'vendor/lamejs.min.js',
    'js/export-safeguards.js',
    'js/frame-source.js',
    'js/canvas-export.js',
    'js/webcodecs-export.js',
    'js/webm-webcodecs-export.js',
    'js/mp3-export.js',
    'js/unified-export.js',
    'js/i18n.js',
    'js/ctf-advanced.js',
    'js/app.js',
    'img/CUT_THE_FLOW_b.svg',
    'img/icon-192.png',
    'img/icon-512.png',
    'img/icon-512-maskable.png',
    'img/apple-touch-icon.png',
    'logo_cut_the_flow_20_blanc.png'
];

const targetFiles = [
    'index.html',
    'manifest.json',
    'service-worker.js'
];

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getHash(filePath) {
    const absolutePath = path.join(root, filePath);
    const buffer = fs.readFileSync(absolutePath);
    return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 10);
}

const hashes = new Map(assets.map((asset) => [asset, getHash(asset)]));

for (const targetFile of targetFiles) {
    const absolutePath = path.join(root, targetFile);
    let content = fs.readFileSync(absolutePath, 'utf8');

    for (const asset of assets) {
        const hashedRef = `${asset}?v=${hashes.get(asset)}`;
        // Remplace aussi une ancienne valeur de cache-buster, quelle qu'elle soit
        // (`20260917f`, `1.2.1`…) : l'ancienne expression n'acceptait que 10
        // caractères hexadécimaux et produisait `?v=abc?v=20260917f`.
        const pattern = new RegExp(`${escapeRegExp(asset)}(?:\\?v=[^"'\\s)]*)?`, 'g');
        content = content.replace(pattern, hashedRef);
    }

    fs.writeFileSync(absolutePath, content, 'utf8');
}

console.log('CUT THE FLOW asset hashes synced:');
for (const asset of assets) {
    console.log(`${asset}?v=${hashes.get(asset)}`);
}