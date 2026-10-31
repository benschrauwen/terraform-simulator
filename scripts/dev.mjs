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

/*
 * vercel.json uses legacy `routes` rather than `headers` + `rewrites`: Vercel checks
 * the filesystem before applying `rewrites`, so a host rewrite of `/` or `/sources.html`
 * (both real files) would never fire. Routes run before the filesystem, in order.
 *
 * The dev server mirrors the two route shapes the config uses:
 *   { src, headers, continue: true }        adds headers when src matches the path;
 *   { src, dest, has?: [{ type: 'host' }] }  rewrites the path (first match wins).
 * Anything else is rejected so dev never silently diverges from production.
 *
 * Dev host aliases: browsers resolve every `*.localhost` name to loopback, so a
 * request for `<name>.localhost` matches a `has` host rule for `<name>.com`. For
 * example http://abundancestack.localhost:4173/ gets the abundancestack.com routes,
 * while http://localhost:4173/ (or 127.0.0.1) gets none, like terraform-simulator.com.
 */
const ROUTE_KEYS = new Set(['src', 'headers', 'continue', 'dest', 'has']);
const DEST_PATTERN = /^\/[\w./-]*$/;
const HOST_VALUE_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i;

function compileRouteSource(src) {
  if (typeof src !== 'string' || !src.startsWith('^/') || !src.endsWith('$')) {
    throw new Error(`Unsupported vercel.json route src (must be an anchored path regex): ${src}`);
  }
  return new RegExp(src);
}

/**
 * Turn vercel.json `routes` into { headerRules, rewriteRules } so the dev server sends
 * the production CSP and security headers (violations show up locally) and applies the
 * same host-based page routing.
 */
export function parseRouteRules(config) {
  const unsupportedKeys = ['headers', 'rewrites', 'redirects', 'cleanUrls', 'trailingSlash']
    .filter(key => config?.[key] !== undefined);
  if (unsupportedKeys.length > 0) {
    throw new Error(`vercel.json must express ${unsupportedKeys.join(', ')} as routes (Vercel rejects mixing them with routes).`);
  }
  const headerRules = [];
  const rewriteRules = [];
  (config?.routes || []).forEach(route => {
    const unknown = Object.keys(route || {}).filter(key => !ROUTE_KEYS.has(key));
    if (unknown.length > 0) throw new Error(`Unsupported vercel.json route keys: ${unknown.join(', ')}`);
    const pattern = compileRouteSource(route.src);

    if (route.headers !== undefined) {
      if (rewriteRules.length > 0) {
        throw new Error(`vercel.json header route ${route.src} follows a rewrite route; Vercel stops at the rewrite.`);
      }
      if (route.continue !== true || route.dest !== undefined || route.has !== undefined) {
        throw new Error(`Unsupported vercel.json header route (needs continue: true, no dest/has): ${route.src}`);
      }
      headerRules.push({ pattern, headers: { ...route.headers } });
      return;
    }

    if (typeof route.dest !== 'string' || !DEST_PATTERN.test(route.dest) || route.continue !== undefined) {
      throw new Error(`Unsupported vercel.json rewrite route: ${route.src} -> ${route.dest}`);
    }
    const hosts = (route.has || []).map(condition => {
      if (condition?.type !== 'host' || !HOST_VALUE_PATTERN.test(condition.value || '')) {
        throw new Error(`Unsupported vercel.json route condition: ${JSON.stringify(condition)}`);
      }
      return condition.value.toLowerCase();
    });
    rewriteRules.push({ pattern, hosts, destination: route.dest });
  });
  return { headerRules, rewriteRules };
}

export function loadRouteRules(configPath = VERCEL_CONFIG_PATH) {
  return parseRouteRules(JSON.parse(readFileSync(configPath, 'utf8')));
}

/** Headers for a request path: every matching rule in order, then BASE_HEADERS. */
export function headersForPath(pathname, headerRules = []) {
  const headers = {};
  headerRules.forEach(rule => {
    if (rule.pattern.test(pathname)) Object.assign(headers, rule.headers);
  });
  return { ...headers, ...BASE_HEADERS };
}

/** The hostname a Host header's routes are matched against: lowercased, no port, `*.localhost` -> `*.com`. */
export function routingHostname(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return '';
  let hostname;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return '';
  }
  return hostname.endsWith('.localhost') ? `${hostname.slice(0, -'.localhost'.length)}.com` : hostname;
}

/** The path to serve: the first rewrite rule whose path and host conditions match, else the path itself. */
export function rewritePath(pathname, hostHeader, rewriteRules = []) {
  const hostname = routingHostname(hostHeader);
  const rule = rewriteRules.find(candidate => (
    candidate.pattern.test(pathname) && candidate.hosts.every(host => host === hostname)
  ));
  return rule ? rule.destination : pathname;
}

let defaultRouteRules = null;
function getDefaultRouteRules() {
  defaultRouteRules ??= loadRouteRules();
  return defaultRouteRules;
}

export function createStaticServer(root, { routeRules = getDefaultRouteRules() } = {}) {
  return http.createServer((request, response) => {
    serveStaticRequest(request, response, root, routeRules).catch(() => {
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

export async function serveStaticRequest(request, response, root, routeRules = getDefaultRouteRules()) {
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

  // Header routes precede the rewrite routes in vercel.json, so they match the requested
  // path; the rewritten path still goes through every check below.
  const headers = headersForPath(requestUrl.pathname, routeRules.headerRules);
  const servedPath = rewritePath(requestUrl.pathname, host, routeRules.rewriteRules);
  const resolvedPath = resolveStaticPath(root, servedPath);

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
    const routedHosts = new Set(getDefaultRouteRules().rewriteRules.flatMap(rule => rule.hosts));
    routedHosts.forEach(hostname => {
      if (hostname.endsWith('.com') && !hostname.startsWith('www.')) {
        console.log(`  ${hostname} pages: http://${hostname.slice(0, -'.com'.length)}.localhost:${port}/`);
      }
    });
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
