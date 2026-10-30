import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PAGES = ['index.html', 'sources.html', 'datacenter.html', 'datacenter-sources.html'];

// Every build goes to a fresh temp directory so tests never touch (or race) the real dist/.
function build(t, env = {}) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-build-test-'));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  const { BUILD_ID: _ignored, ...baseEnv } = process.env;
  execFileSync(process.execPath, ['scripts/build.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...baseEnv, DIST_DIR: dist, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return dist;
}

function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relativePath)
      : [relativePath];
  });
}

test('production build ships an allowlisted, versioned asset tree', t => {
  const BUILD_ID = 'test-build';
  const ASSET_DIR = `assets/${BUILD_ID}`;
  const dist = build(t, { BUILD_ID });
  const exists = relativePath => fs.existsSync(path.join(dist, relativePath));

  [
    'index.html',
    'sources.html',
    'datacenter.html',
    'datacenter-sources.html',
    'README.md',
    'LICENSE',
    `${ASSET_DIR}/style.css`,
    `${ASSET_DIR}/datacenter.css`,
    `${ASSET_DIR}/js/main.js`,
    `${ASSET_DIR}/js/ui/app.js`,
    `${ASSET_DIR}/js/datacenter-main.js`,
    `${ASSET_DIR}/js/ui/datacenter/app.js`,
    `${ASSET_DIR}/js/model/index.js`,
    `${ASSET_DIR}/js/model/scenario.js`,
    `${ASSET_DIR}/js/workers/optimizer-worker.js`,
    `${ASSET_DIR}/vendor/chart.umd.js`,
    `${ASSET_DIR}/vendor/leaflet/leaflet.js`,
    `${ASSET_DIR}/vendor/leaflet/leaflet.css`,
    `${ASSET_DIR}/vendor/leaflet/images/layers.png`,
    `${ASSET_DIR}/vendor/lz-string.min.js`,
  ].forEach(relativePath => {
    assert.equal(exists(relativePath), true, `Expected ${relativePath} in dist.`);
  });

  const files = listFiles(dist);
  files.forEach(relativePath => {
    assert.ok(
      [...PAGES, 'README.md', 'LICENSE'].includes(relativePath) || relativePath.startsWith(`${ASSET_DIR}/`),
      `Unexpected file outside the allowlist: ${relativePath}`
    );
    assert.equal(
      relativePath.split('/').some(segment => segment.startsWith('.')),
      false,
      `Expected no dotfiles in dist: ${relativePath}`
    );
    assert.doesNotMatch(relativePath, /^(?:node_modules|scripts|tests|package(?:-lock)?\.json|vercel\.json)/);
  });

  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const urls = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(urls.length >= 6);
  urls.forEach(url => {
    assert.ok(url.startsWith(`${ASSET_DIR}/`), `Expected ${url} to be versioned under ${ASSET_DIR}/.`);
    assert.equal(exists(url), true, `Expected ${url} to resolve inside dist.`);
  });
  assert.match(html, new RegExp(`<script type="module" src="${ASSET_DIR}/js/main\\.js"></script>`));

  // The sources page shares the versioned stylesheet and links back unversioned.
  const sourcesHtml = fs.readFileSync(path.join(dist, 'sources.html'), 'utf8');
  assert.match(sourcesHtml, new RegExp(`href="${ASSET_DIR}/style\\.css"`));
  assert.match(sourcesHtml, /href="index\.html"/);
  assert.match(html, /href="sources\.html"/);

  // The datacenter pages get the same treatment, with their own module entry.
  const datacenterHtml = fs.readFileSync(path.join(dist, 'datacenter.html'), 'utf8');
  const datacenterUrls = [...datacenterHtml.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(datacenterUrls.length >= 6);
  datacenterUrls.forEach(url => {
    assert.ok(url.startsWith(`${ASSET_DIR}/`), `Expected ${url} to be versioned under ${ASSET_DIR}/.`);
    assert.equal(exists(url), true, `Expected ${url} to resolve inside dist.`);
  });
  assert.match(datacenterHtml, new RegExp(`<script type="module" src="${ASSET_DIR}/js/datacenter-main\\.js"></script>`));
  assert.match(datacenterHtml, /href="datacenter-sources\.html"/);
  const datacenterSourcesHtml = fs.readFileSync(path.join(dist, 'datacenter-sources.html'), 'utf8');
  assert.match(datacenterSourcesHtml, new RegExp(`href="${ASSET_DIR}/style\\.css"`));
  assert.match(datacenterSourcesHtml, /href="datacenter\.html"/);

  // vercel.json routes abundancestack.com to these pages; every route target must ship.
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  vercelConfig.routes.filter(route => route.dest).forEach(route => {
    assert.equal(exists(route.dest.slice(1)), true, `Expected route target ${route.dest} in dist.`);
  });
});

test('the asset version is a content hash, identical for identical sources', t => {
  // A commit SHA in the environment must not decide the version: a dirty tree or
  // CLI deploy would reuse it for different bytes under an immutable cache header.
  const first = fs.readdirSync(path.join(build(t, { VERCEL_GIT_COMMIT_SHA: 'aaaaaaaaaaaa' }), 'assets'));
  const second = fs.readdirSync(path.join(build(t, { VERCEL_GIT_COMMIT_SHA: 'bbbbbbbbbbbb' }), 'assets'));
  assert.equal(first.length, 1);
  assert.match(first[0], /^[0-9a-f]{12}$/);
  assert.deepEqual(second, first);
});

test('the footer shows the release version, commit date and short sha', t => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const dist = build(t, { RELEASE_DATE: '2026-10-30', RELEASE_SHA: 'abcdef1234567890' });
  PAGES.forEach(page => {
    const html = fs.readFileSync(path.join(dist, page), 'utf8');
    assert.match(html, new RegExp(`id="appVersion">v${version.replaceAll('.', '\\.')} · 2026-10-30 · abcdef1</span>`), page);
    // The source pages keep a neutral label so `npm run dev` never claims to be a release.
    assert.match(fs.readFileSync(path.join(ROOT, page), 'utf8'), /id="appVersion">Development build</, page);
  });
});
