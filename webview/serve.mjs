import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webviewDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(webviewDir, 'dist');
const argIndex = process.argv.indexOf('--port');
const port = Number(argIndex >= 0 ? process.argv[argIndex + 1] : process.env.PORT || 4173);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function within(root, file) {
  return file === root || file.startsWith(`${root}/`);
}

async function resolveRequest(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
  const file = resolve(distDir, relative);
  if (!within(distDir, file)) return null;
  return { file };
}

const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const target = await resolveRequest(pathname);
    if (!target) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    const info = await stat(target.file);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(target.file)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    if (request.method !== 'HEAD') createReadStream(target.file).pipe(response);
    else response.end();
  } catch (error) {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving webview on http://127.0.0.1:${port}/`);
});
