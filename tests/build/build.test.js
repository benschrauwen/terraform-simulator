const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'dist');

function exists(relativePath) {
  return fs.existsSync(path.join(DIST, relativePath));
}

test('production build excludes local development artifacts', () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  [
    'index.html',
    'style.css',
    'js/app.js',
    'js/calculations/calculations-core.js',
    'node_modules/lz-string/libs/lz-string.min.js',
  ].forEach(relativePath => {
    assert.equal(exists(relativePath), true, `Expected ${relativePath} in dist.`);
  });

  [
    '.agents',
    '.claude',
    '.codex',
    '.DS_Store',
    '.git',
    '.gitignore',
    'js/NOTES.md',
    'node_modules/.package-lock.json',
    'outputs',
    'package-lock.json',
    'package.json',
    'scripts',
    'software-quality-report',
    'tests',
    'vercel.json',
  ].forEach(relativePath => {
    assert.equal(exists(relativePath), false, `Expected ${relativePath} to be excluded from dist.`);
  });

  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  assert.match(html, /style\.css\?v=/, 'Expected local CSS URL to be versioned.');
  assert.match(html, /js\/app\.js\?v=/, 'Expected local JS URL to be versioned.');
});
