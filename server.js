const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.data': 'application/octet-stream',
};

function sendFile(res, filePath) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(url.parse(req.url).pathname);

    if (pathname === '/') {
        res.writeHead(302, { Location: '/clientpage/' });
        res.end();
        return;
    }

    if (pathname.endsWith('/')) {
        pathname += 'index.html';
    }

    const filePath = path.resolve(ROOT, '.' + pathname);
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stat) => {
        if (!err && stat.isDirectory()) {
            return sendFile(res, path.join(filePath, 'index.html'));
        }
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        sendFile(res, filePath);
    });
});

server.listen(PORT, () => {
    console.log(`Twistyface listening on port ${PORT}`);
});
