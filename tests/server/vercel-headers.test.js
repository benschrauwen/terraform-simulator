import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { headersForPath, loadHeaderRules, parseHeaderRules, startStaticServer } from '../../scripts/dev.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

function vercelHeader(source, key) {
  return vercelConfig.headers.find(rule => rule.source === source).headers.find(header => header.key === key).value;
}

test('dev server header rules mirror vercel.json, minus production caching', () => {
  const rules = loadHeaderRules();
  const csp = vercelHeader('/(.*)', 'Content-Security-Policy');

  const page = headersForPath('/', rules);
  assert.equal(page['Content-Security-Policy'], csp);
  assert.equal(page['Referrer-Policy'], vercelHeader('/(.*)', 'Referrer-Policy'));
  assert.equal(page['Permissions-Policy'], vercelHeader('/(.*)', 'Permissions-Policy'));
  assert.equal(page['Cache-Control'], 'no-store');

  const asset = headersForPath('/assets/abc123/js/main.js', rules);
  assert.equal(asset['Content-Security-Policy'], csp);
  assert.equal(asset['Cache-Control'], 'no-store', 'dev must not send the immutable asset cache header');
  assert.equal(asset['X-Content-Type-Options'], 'nosniff');
});

test('header source patterns match like Vercel globs and reject unsupported syntax', () => {
  const [assets] = parseHeaderRules({ headers: [{ source: '/assets/(.*)', headers: [{ key: 'X-Test', value: '1' }] }] });
  assert.equal(assets.pattern.test('/assets/v1/a.js'), true);
  assert.equal(assets.pattern.test('/assets'), false);
  assert.equal(assets.pattern.test('/js/assets/a.js'), false);
  assert.equal(assets.pattern.test('/assetsX/a.js'), false);
  assert.throws(() => parseHeaderRules({ headers: [{ source: '/:path*', headers: [] }] }), /Unsupported/);
});

test('served responses, including errors, carry the vercel.json CSP', async t => {
  const { server, host, port } = await startStaticServer({ port: 0, host: '127.0.0.1' });
  t.after(() => server.close());
  const csp = vercelHeader('/(.*)', 'Content-Security-Policy');

  const ok = await fetch(`http://${host}:${port}/index.html`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-security-policy'), csp);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  await ok.arrayBuffer();

  const missing = await fetch(`http://${host}:${port}/missing.js`);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('content-security-policy'), csp);
  await missing.arrayBuffer();
});
