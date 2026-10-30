import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { headersForPath, loadRouteRules, parseRouteRules, startStaticServer } from '../../scripts/dev.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

function vercelHeader(src, key) {
  return vercelConfig.routes.find(route => route.src === src).headers[key];
}

test('dev server header rules mirror vercel.json, minus production caching', () => {
  const { headerRules } = loadRouteRules();
  const csp = vercelHeader('^/(.*)$', 'Content-Security-Policy');

  const page = headersForPath('/', headerRules);
  assert.equal(page['Content-Security-Policy'], csp);
  assert.equal(page['Referrer-Policy'], vercelHeader('^/(.*)$', 'Referrer-Policy'));
  assert.equal(page['Permissions-Policy'], vercelHeader('^/(.*)$', 'Permissions-Policy'));
  assert.equal(page['Cache-Control'], 'no-store');

  const asset = headersForPath('/assets/abc123/js/main.js', headerRules);
  assert.equal(asset['Content-Security-Policy'], csp);
  assert.equal(asset['Cache-Control'], 'no-store', 'dev must not send the immutable asset cache header');
  assert.equal(asset['X-Content-Type-Options'], 'nosniff');
});

test('header route patterns match anchored paths and unsupported config is rejected', () => {
  const header = { src: '^/assets/(.*)$', headers: { 'X-Test': '1' }, continue: true };
  const { headerRules: [assets] } = parseRouteRules({ routes: [header] });
  assert.equal(assets.pattern.test('/assets/v1/a.js'), true);
  assert.equal(assets.pattern.test('/assets'), false);
  assert.equal(assets.pattern.test('/js/assets/a.js'), false);
  assert.equal(assets.pattern.test('/assetsX/a.js'), false);

  // Unanchored sources, unknown keys, non-host conditions, headers mixed with routes,
  // and header routes after a rewrite (Vercel would stop at the rewrite) all throw.
  const rewrite = { src: '^/$', dest: '/b.html' };
  assert.throws(() => parseRouteRules({ routes: [{ ...header, src: '/assets/(.*)' }] }), /anchored/);
  assert.throws(() => parseRouteRules({ routes: [{ ...rewrite, status: 301 }] }), /Unsupported vercel\.json route keys/);
  assert.throws(() => parseRouteRules({ routes: [{ ...rewrite, has: [{ type: 'header', key: 'x' }] }] }), /condition/);
  assert.throws(() => parseRouteRules({ routes: [{ ...rewrite, dest: 'https://example.com/' }] }), /rewrite route/);
  assert.throws(() => parseRouteRules({ headers: [], routes: [] }), /as routes/);
  assert.throws(() => parseRouteRules({ rewrites: [] }), /as routes/);
  assert.throws(() => parseRouteRules({ routes: [rewrite, header] }), /follows a rewrite/);
});

test('served responses, including errors, carry the vercel.json CSP', async t => {
  const { server, host, port } = await startStaticServer({ port: 0, host: '127.0.0.1' });
  t.after(() => server.close());
  const csp = vercelHeader('^/(.*)$', 'Content-Security-Policy');

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
