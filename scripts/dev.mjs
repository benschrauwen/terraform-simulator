import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MIME_TYPES = {
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

export function createStaticServer(root) {
  return http.createServer((request, response) => {
    serveStaticRequest(request, response, root);
  });
}

export async function startStaticServer({
  rootArgument = '.',
  port = Number(process.env.PORT || process.env.npm_config_port || 4173),
} = {}) {
  const root = path.resolve(__dirname, '..', rootArgument);
  await fs.access(root);
  const server = createStaticServer(root);

  await new Promise((resolve, reject) => {
    const handleError = error => {
      server.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off('error', handleError);
      resolve();
    };
    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port);
  });

  const actualPort = server.address()?.port || port;
  return { server, root, port: actualPort };
}

export async function serveStaticRequest(request, response, root) {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const resolvedPath = resolveStaticPath(root, requestUrl.pathname);

  if (resolvedPath.status === 400) {
    writeTextResponse(response, 400, 'Bad request');
    return;
  }

  if (resolvedPath.status === 403) {
    writeTextResponse(response, 403, 'Forbidden');
    return;
  }

  const filePath = await resolveFilePath(resolvedPath.candidatePath);
  if (!filePath) {
    writeTextResponse(response, 404, 'Not found');
    return;
  }

  let contents;
  try {
    contents = await fs.readFile(filePath);
  } catch {
    writeTextResponse(response, 404, 'Not found');
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': getContentType(filePath),
  });
  response.end(contents);
}

export function resolveStaticPath(root, rawPathname) {
  let pathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return { status: 400, candidatePath: null };
  }

  if (pathname.endsWith('/')) {
    pathname = `${pathname}index.html`;
  }

  const normalizedPath = path.normalize(pathname).replace(/^(\.\.(?:\/|\\|$))+/, '');
  const candidatePath = path.resolve(root, `.${path.sep}${normalizedPath}`);

  if (!isPathInsideRoot(root, candidatePath)) {
    return { status: 403, candidatePath: null };
  }

  return { status: 200, candidatePath };
}

export function isPathInsideRoot(root, candidatePath) {
  const relative = path.relative(root, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES[extension] || 'application/octet-stream';
}

export async function resolveFilePath(candidatePath) {
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

function writeTextResponse(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    const rootArgument = process.argv[2] || '.';
    const { root, port } = await startStaticServer({ rootArgument });
    console.log(`Serving ${root} at http://localhost:${port}`);
  } catch (error) {
    const rootArgument = process.argv[2] || '.';
    const root = path.resolve(__dirname, '..', rootArgument);
    if (error?.code === 'ENOENT') {
      console.error(`Static root not found: ${root}`);
    } else {
      console.error(error?.message || String(error));
    }
    process.exit(1);
  }
}
