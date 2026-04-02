import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootArgument = process.argv[2] || '.';
const ROOT = path.resolve(__dirname, '..', rootArgument);
const PORT = Number(process.env.PORT || process.env.npm_config_port || 4173);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

try {
  await fs.access(ROOT);
} catch {
  console.error(`Static root not found: ${ROOT}`);
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname.endsWith('/')) {
    pathname = `${pathname}index.html`;
  }

  const normalizedPath = path.normalize(pathname).replace(/^(\.\.(?:\/|\\|$))+/, '');
  const candidatePath = path.resolve(ROOT, `.${path.sep}${normalizedPath}`);

  if (!candidatePath.startsWith(ROOT)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  const filePath = await resolveFilePath(candidatePath);
  if (!filePath) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';
  const contents = await fs.readFile(filePath);

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
  });
  response.end(contents);
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
});

async function resolveFilePath(candidatePath) {
  try {
    const stat = await fs.stat(candidatePath);
    if (stat.isDirectory()) {
      return resolveFilePath(path.join(candidatePath, 'index.html'));
    }
    return candidatePath;
  } catch {
    return null;
  }
}
