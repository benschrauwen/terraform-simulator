import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const BUILD_ID = 'test-build';
const ASSET_DIR = `assets/${BUILD_ID}`;

function exists(relativePath) {
  return fs.existsSync(path.join(DIST, relativePath));
}

function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relativePath)
      : [relativePath];
  });
}

test('production build ships an allowlisted, versioned asset tree', () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, BUILD_ID },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  [
    'index.html',
    'README.md',
    'LICENSE',
    `${ASSET_DIR}/style.css`,
    `${ASSET_DIR}/js/main.js`,
    `${ASSET_DIR}/js/ui/app.js`,
    `${ASSET_DIR}/js/model/index.js`,
    `${ASSET_DIR}/js/model/core.js`,
    `${ASSET_DIR}/js/workers/optimizer-worker.js`,
    `${ASSET_DIR}/vendor/chart.umd.js`,
    `${ASSET_DIR}/vendor/leaflet/leaflet.js`,
    `${ASSET_DIR}/vendor/leaflet/leaflet.css`,
    `${ASSET_DIR}/vendor/leaflet/images/layers.png`,
    `${ASSET_DIR}/vendor/lz-string.min.js`,
  ].forEach(relativePath => {
    assert.equal(exists(relativePath), true, `Expected ${relativePath} in dist.`);
  });

  const files = listFiles(DIST);
  files.forEach(relativePath => {
    assert.ok(
      ['index.html', 'README.md', 'LICENSE'].includes(relativePath) || relativePath.startsWith(`${ASSET_DIR}/`),
      `Unexpected file outside the allowlist: ${relativePath}`
    );
    assert.equal(
      relativePath.split('/').some(segment => segment.startsWith('.')),
      false,
      `Expected no dotfiles in dist: ${relativePath}`
    );
    assert.doesNotMatch(relativePath, /^(?:node_modules|scripts|tests|package(?:-lock)?\.json|vercel\.json)/);
  });

  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const urls = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(urls.length >= 6);
  urls.forEach(url => {
    assert.ok(url.startsWith(`${ASSET_DIR}/`), `Expected ${url} to be versioned under ${ASSET_DIR}/.`);
    assert.equal(exists(url), true, `Expected ${url} to resolve inside dist.`);
  });
  assert.match(html, new RegExp(`<script type="module" src="${ASSET_DIR}/js/main\\.js"></script>`));
});
