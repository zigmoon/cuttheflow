const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const port = Number(process.argv[3] || process.env.PORT || 4173);
const host = '127.0.0.1';

const mimeTypes = {
    '.avif': 'image/avif',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'application/javascript; charset=utf-8',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2'
};

const IMMUTABLE_EXTENSIONS = new Set([
    '.avif',
    '.css',
    '.jpeg',
    '.jpg',
    '.js',
    '.mjs',
    '.png',
    '.svg',
    '.ttf',
    '.webp',
    '.woff',
    '.woff2'
]);

function send(res, status, body, type) {
    res.writeHead(status, {
        'Cache-Control': 'no-cache',
        'Content-Type': type || 'text/plain; charset=utf-8'
    });
    res.end(body);
}

function resolveFilePath(rawUrl) {
    const pathname = decodeURIComponent((rawUrl || '/').split('?')[0]);
    const relativePath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.normalize(path.join(root, relativePath));
    if (!filePath.startsWith(root)) {
        return null;
    }
    return filePath;
}

function getCacheControl(rawUrl, targetPath) {
    const requestUrl = new URL(rawUrl || '/', `http://${host}:${port}`);
    const pathname = requestUrl.pathname;
    const ext = path.extname(targetPath).toLowerCase();

    if (pathname.endsWith('/service-worker.js') || pathname.endsWith('/manifest.json') || ext === '.html' || ext === '.webmanifest') {
        return 'no-cache, no-store, must-revalidate';
    }

    if (requestUrl.searchParams.has('v') || IMMUTABLE_EXTENSIONS.has(ext)) {
        return 'public, max-age=31536000, immutable';
    }

    return 'public, max-age=3600';
}

const server = http.createServer((req, res) => {
    const filePath = resolveFilePath(req.url);
    if (!filePath) {
        send(res, 403, 'Forbidden');
        return;
    }

    fs.stat(filePath, (statError, stats) => {
        let targetPath = filePath;

        if (!statError && stats.isDirectory()) {
            targetPath = path.join(filePath, 'index.html');
        }

        fs.readFile(targetPath, (readError, data) => {
            if (readError) {
                send(res, 404, 'Not found');
                return;
            }

            const ext = path.extname(targetPath).toLowerCase();
            const type = mimeTypes[ext] || 'application/octet-stream';
            res.writeHead(200, {
                'Cache-Control': getCacheControl(req.url, targetPath),
                'Content-Type': type
            });
            res.end(data);
        });
    });
});

server.listen(port, host, () => {
    console.log(`CUT THE FLOW dev server listening on http://${host}:${port}`);
    console.log(`Serving ${root}`);
});