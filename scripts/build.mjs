import { execSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const ASSET_DIR = `assets/${getBuildId()}`;

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

rmSync(DIST, { recursive: true, force: true });
ROOT_FILES.forEach(file => cpSync(path.join(ROOT, file), path.join(DIST, file)));
Object.entries(ASSETS).forEach(([target, source]) => {
  cpSync(path.join(ROOT, source), path.join(DIST, ASSET_DIR, target), {
    recursive: true,
    filter: file => !path.basename(file).startsWith('.'),
  });
});

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/\b(src|href)="([^"]+)"/g, (match, attribute, url) => {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(url)) return match;
    const entry = Object.entries(ASSETS).find(([, source]) => url === source || url.startsWith(`${source}/`));
    if (!entry) throw new Error(`index.html references ${url}, which is not in the build allowlist.`);
    return `${attribute}="${ASSET_DIR}/${entry[0]}${url.slice(entry[1].length)}"`;
  });
writeFileSync(path.join(DIST, 'index.html'), html);

console.log(`Built dist/ with assets under ${ASSET_DIR}/`);

function getBuildId() {
  const envBuildId = (process.env.BUILD_ID || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
  if (envBuildId) return envBuildId.slice(0, 12).replace(/[^\w.-]/g, '');
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  }
}
