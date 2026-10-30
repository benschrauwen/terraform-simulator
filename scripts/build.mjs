import { createHash } from 'node:crypto';
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// DIST_DIR lets tests build into a throwaway directory instead of the real dist/.
const DIST = path.resolve(ROOT, process.env.DIST_DIR || 'dist');

// Allowlist: nothing outside these paths reaches dist/. Versioned assets live under
// dist/assets/<buildId>/ so relative ES-module imports and the worker URL inherit the
// version, and only index.html needs rewriting.
const ROOT_FILES = ['README.md', 'LICENSE'];
const ASSETS = {
  // dist path (under ASSET_DIR) -> source path
  'style.css': 'style.css',
  'js': 'js',
  'vendor/chart.umd.js': 'node_modules/chart.js/dist/chart.umd.js',
  'vendor/leaflet/leaflet.js': 'node_modules/leaflet/dist/leaflet.js',
  'vendor/leaflet/leaflet.css': 'node_modules/leaflet/dist/leaflet.css',
  'vendor/leaflet/images': 'node_modules/leaflet/dist/images',
  'vendor/lz-string.min.js': 'node_modules/lz-string/libs/lz-string.min.js',
};

const isShipped = file => !path.basename(file).startsWith('.');
const ASSET_DIR = `assets/${getBuildId()}`;

rmSync(DIST, { recursive: true, force: true });
ROOT_FILES.forEach(file => cpSync(path.join(ROOT, file), path.join(DIST, file)));
Object.entries(ASSETS).forEach(([target, source]) => {
  cpSync(path.join(ROOT, source), path.join(DIST, ASSET_DIR, target), { recursive: true, filter: isShipped });
});

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/\b(src|href)="([^"]+)"/g, (match, attribute, url) => {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(url)) return match;
    const entry = Object.entries(ASSETS).find(([, source]) => url === source || url.startsWith(`${source}/`));
    if (!entry) throw new Error(`index.html references ${url}, which is not in the build allowlist.`);
    return `${attribute}="${ASSET_DIR}/${entry[0]}${url.slice(entry[1].length)}"`;
  });
writeFileSync(path.join(DIST, 'index.html'), html);

console.log(`Built ${DIST} with assets under ${ASSET_DIR}/`);

/**
 * /assets/* is served immutable, so the version must change whenever any shipped
 * byte changes and stay the same when nothing did. Hash every asset file (dist path
 * and contents) instead of using the commit SHA, which a dirty tree or a CLI deploy
 * would reuse for different content. BUILD_ID overrides it (tests use a fixed id).
 */
function getBuildId() {
  const envBuildId = (process.env.BUILD_ID || '').trim().replace(/[^\w.-]/g, '');
  if (envBuildId) return envBuildId.slice(0, 32);
  const hash = createHash('sha256');
  Object.entries(ASSETS).forEach(([target, source]) => {
    const sourcePath = path.join(ROOT, source);
    listShippedFiles(sourcePath).forEach(file => {
      const relative = path.relative(sourcePath, file).split(path.sep).join('/');
      hash.update(`${target}/${relative}\0`);
      hash.update(readFileSync(file));
      hash.update('\0');
    });
  });
  return hash.digest('hex').slice(0, 12);
}

function listShippedFiles(source) {
  if (!statSync(source).isDirectory()) return [source];
  return readdirSync(source, { withFileTypes: true })
    .filter(entry => isShipped(entry.name))
    .map(entry => entry.name)
    .sort()
    .flatMap(name => listShippedFiles(path.join(source, name)));
}
