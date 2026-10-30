import http from 'node:http';
import { promises as fs, readFileSync } from 'node:fs';
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
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const DEFAULT_HOST = '127.0.0.1';

// Always applied last, so dev never caches (vercel.json's immutable /assets/* rule is dropped).
const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const VERCEL_CONFIG_PATH = path.join(__dirname, '..', 'vercel.json');

/**
 * Turn vercel.json `headers` entries into { pattern, headers } rules so the dev server
 * sends the production CSP and security headers and violations show up locally.
 * Only literal paths with `(.*)` wildcards (e.g. `/(.*)`, `/assets/(.*)`) are supported.
 */
export function parseHeaderRules(config) {
  return (config?.headers || []).map(({ source, headers }) => {
    if (typeof source !== 'string' || !/^\/(?:[\w./-]|\(\.\*\))*$/.test(source)) {
      throw new Error(`Unsupported vercel.json header source pattern: ${source}`);
    }
    const regex = source.split('(.*)')
      .map(literal => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return {
      pattern: new RegExp(`^${regex}$`),
      headers: Object.fromEntries((headers || []).map(({ key, value }) => [key, value])),
    };
  });
}

export function loadHeaderRules(configPath = VERCEL_CONFIG_PATH) {
  return parseHeaderRules(JSON.parse(readFileSync(configPath, 'utf8')));
}

/** Headers for a request path: every matching rule in order, then BASE_HEADERS. */
export function headersForPath(pathname, headerRules = []) {
  const headers = {};
  headerRules.forEach(rule => {
    if (rule.pattern.test(pathname)) Object.assign(headers, rule.headers);
  });
  return { ...headers, ...BASE_HEADERS };
}

let defaultHeaderRules = null;
function getDefaultHeaderRules() {
  defaultHeaderRules ??= loadHeaderRules();
  return defaultHeaderRules;
}

export function createStaticServer(root, { headerRules = getDefaultHeaderRules() } = {}) {
  return http.createServer((request, response) => {
    serveStaticRequest(request, response, root, headerRules).catch(() => {
      if (!response.headersSent) {
        writeTextResponse(response, 400, 'Bad request');
      } else {
        response.end();
      }
    });
  });
}

export async function startStaticServer({
  rootArgument = '.',
  port = Number(process.env.PORT || process.env.npm_config_port || 4173),
  host = process.env.HOST || DEFAULT_HOST,
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
    server.listen(port, host);
  });

  const actualPort = server.address()?.port || port;
  return { server, root, host, port: actualPort };
}

export async function serveStaticRequest(request, response, root, headerRules = getDefaultHeaderRules()) {
  const host = request.headers?.host;
  if (host !== undefined && !isValidHostHeader(host)) {
    writeTextResponse(response, 400, 'Bad request');
    return;
  }

  // Parse against a fixed base: the client-controlled Host header must never influence
  // path resolution or be able to make URL parsing throw.
  let requestUrl;
  try {
    requestUrl = new URL(request.url || '/', 'http://localhost');
  } catch {
    writeTextResponse(response, 400, 'Bad request');
    return;
  }

  const headers = headersForPath(requestUrl.pathname, headerRules);
  const resolvedPath = resolveStaticPath(root, requestUrl.pathname);

  if (resolvedPath.status === 400) {
    writeTextResponse(response, 400, 'Bad request', headers);
    return;
  }

  if (resolvedPath.status === 403) {
    writeTextResponse(response, 403, 'Forbidden', headers);
    return;
  }

  if (resolvedPath.status === 404) {
    writeTextResponse(response, 404, 'Not found', headers);
    return;
  }

  const filePath = await resolveFilePath(resolvedPath.candidatePath);
  if (!filePath || !(await isRealPathInsideRoot(root, filePath))) {
    writeTextResponse(response, 404, 'Not found', headers);
    return;
  }

  let contents;
  try {
    contents = await fs.readFile(filePath);
  } catch {
    writeTextResponse(response, 404, 'Not found', headers);
    return;
  }

  response.writeHead(200, {
    ...headers,
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

  // Never serve dotfiles or anything inside dot-directories (.git, .env, .DS_Store, ...).
  if (hasHiddenSegment(path.relative(root, candidatePath))) {
    return { status: 404, candidatePath: null };
  }

  return { status: 200, candidatePath };
}

export function hasHiddenSegment(relativePath) {
  return relativePath.split(/[\\/]+/).some(segment => segment.startsWith('.'));
}

// The lexical root check above does not account for symlinks; compare canonical paths
// so a link inside the root cannot expose files outside it (or hidden files inside it).
export async function isRealPathInsideRoot(root, filePath) {
  try {
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(filePath)]);
    return isPathInsideRoot(realRoot, realFile) && !hasHiddenSegment(path.relative(realRoot, realFile));
  } catch {
    return false;
  }
}

function isValidHostHeader(host) {
  if (typeof host !== 'string' || host === '' || /[\s/?#@\\]/.test(host)) {
    return false;
  }
  try {
    return new URL(`http://${host}`).host !== '';
  } catch {
    return false;
  }
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

function writeTextResponse(response, statusCode, body, headers = BASE_HEADERS) {
  response.writeHead(statusCode, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    const rootArgument = process.argv[2] || '.';
    const { root, host, port } = await startStaticServer({ rootArgument });
    const displayHost = host.includes(':') ? `[${host}]` : host;
    console.log(`Serving ${root} at http://${displayHost}:${port}`);
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
