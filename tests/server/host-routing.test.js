/*
 * One deployment serves two sites: terraform-simulator.com (index.html, sources.html)
 * and abundancestack.com, whose / and /sources.html are routed by Host header to
 * datacenter.html and datacenter-sources.html. In dev, `<name>.localhost` stands in
 * for `<name>.com` (browsers resolve *.localhost to loopback).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createStaticServer,
  loadRouteRules,
  parseRouteRules,
  rewritePath,
  routingHostname,
  startStaticServer,
} from '../../scripts/dev.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

function get(port, urlPath, host) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath, headers: host ? { host } : {} }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      })
      .on('error', reject);
  });
}

const titleOf = html => html.match(/<title>([^<]*)<\/title>/)?.[1] || '';

test('vercel.json routes abundancestack.com by host before the filesystem', () => {
  // Vercel applies `rewrites` only after checking the filesystem, and / and
  // /sources.html are real files, so host routing must use `routes` (which run first).
  assert.equal(vercelConfig.rewrites, undefined);
  assert.equal(vercelConfig.headers, undefined);
  assert.equal(vercelConfig.routes.some(route => route.handle), false, 'No route may precede the host routes with a handle.');

  ['abundancestack.com', 'www.abundancestack.com'].forEach(host => {
    const destinations = vercelConfig.routes
      .filter(route => route.has?.some(condition => condition.type === 'host' && condition.value === host))
      .map(route => [route.src, route.dest]);
    assert.deepEqual(destinations, [
      ['^/(?:index\\.html)?$', '/datacenter.html'],
      ['^/sources\\.html$', '/datacenter-sources.html'],
      ['^/sites\\.html$', '/datacenter-sites.html'],
    ], host);
  });
  // Every rewrite target is a shipped page.
  vercelConfig.routes.filter(route => route.dest).forEach(route => {
    assert.equal(fs.existsSync(path.join(ROOT, route.dest)), true, `${route.dest} must exist`);
  });
});

test('routing hostnames ignore case and port and map *.localhost to *.com', () => {
  assert.equal(routingHostname('abundancestack.localhost:4173'), 'abundancestack.com');
  assert.equal(routingHostname('WWW.AbundanceStack.LOCALHOST'), 'www.abundancestack.com');
  assert.equal(routingHostname('abundancestack.com'), 'abundancestack.com');
  assert.equal(routingHostname('localhost:4173'), 'localhost');
  assert.equal(routingHostname('127.0.0.1:4173'), '127.0.0.1');
  assert.equal(routingHostname(undefined), '');
});

test('rewrites send abundancestack hosts to the datacenter pages and leave other hosts alone', () => {
  const { rewriteRules } = loadRouteRules();
  const cases = [
    ['abundancestack.com', '/', '/datacenter.html'],
    ['abundancestack.com', '/index.html', '/datacenter.html'],
    ['abundancestack.com', '/sources.html', '/datacenter-sources.html'],
    ['www.abundancestack.com', '/', '/datacenter.html'],
    ['www.abundancestack.com', '/sources.html', '/datacenter-sources.html'],
    ['abundancestack.localhost:4173', '/', '/datacenter.html'],
    ['abundancestack.localhost:4173', '/sources.html', '/datacenter-sources.html'],
    ['abundancestack.com', '/sites.html', '/datacenter-sites.html'],
    ['www.abundancestack.com', '/sites.html', '/datacenter-sites.html'],
    ['terraform-simulator.com', '/sites.html', '/sites.html'],
    ['abundancestack.com', '/js/main.js', '/js/main.js'],
    ['abundancestack.com', '/datacenter.html', '/datacenter.html'],
    ['abundancestack.com', '/style.css', '/style.css'],
    ['terraform-simulator.com', '/', '/'],
    ['terraform-simulator.com', '/sources.html', '/sources.html'],
    ['www.terraform-simulator.com', '/', '/'],
    ['localhost:4173', '/', '/'],
    ['127.0.0.1:4173', '/sources.html', '/sources.html'],
    ['notabundancestack.com', '/', '/'],
    ['abundancestack.com.example.org', '/', '/'],
    ['shop.abundancestack.com', '/', '/'],
    [undefined, '/', '/'],
  ];
  cases.forEach(([host, pathname, expected]) => {
    assert.equal(rewritePath(pathname, host, rewriteRules), expected, `${host} ${pathname}`);
  });
});

test('the dev server serves the datacenter pages on abundancestack.localhost and the plant builder elsewhere', async t => {
  const { server, port } = await startStaticServer({ port: 0, host: '127.0.0.1' });
  t.after(() => server.close());
  const datacenterTitle = titleOf(fs.readFileSync(path.join(ROOT, 'datacenter.html'), 'utf8'));
  const datacenterSourcesTitle = titleOf(fs.readFileSync(path.join(ROOT, 'datacenter-sources.html'), 'utf8'));
  const indexTitle = titleOf(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  const sourcesTitle = titleOf(fs.readFileSync(path.join(ROOT, 'sources.html'), 'utf8'));

  const abundanceHome = await get(port, '/', `abundancestack.localhost:${port}`);
  assert.equal(abundanceHome.status, 200);
  assert.equal(titleOf(abundanceHome.body), datacenterTitle);
  assert.match(abundanceHome.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(abundanceHome.headers['content-type'], 'text/html; charset=utf-8');

  assert.equal(titleOf((await get(port, '/?s=abc', `abundancestack.localhost:${port}`)).body), datacenterTitle);
  assert.equal(titleOf((await get(port, '/sources.html', `abundancestack.localhost:${port}`)).body), datacenterSourcesTitle);
  assert.equal(titleOf((await get(port, '/', 'www.abundancestack.com')).body), datacenterTitle);

  assert.equal(titleOf((await get(port, '/', `localhost:${port}`)).body), indexTitle);
  assert.equal(titleOf((await get(port, '/sources.html', `127.0.0.1:${port}`)).body), sourcesTitle);
  assert.equal(titleOf((await get(port, '/', 'terraform-simulator.com')).body), indexTitle);
  // The datacenter page also works directly on any host.
  assert.equal(titleOf((await get(port, '/datacenter.html', `localhost:${port}`)).body), datacenterTitle);
});

test('rewrite destinations still pass the dotfile and root checks', async t => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'host-routing-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, 'root', '.git'), { recursive: true });
  fs.writeFileSync(path.join(base, 'root', 'index.html'), 'home');
  fs.writeFileSync(path.join(base, 'root', '.git', 'config'), '[core]');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'outside');

  const host = [{ type: 'host', value: 'abundancestack.com' }];
  const routeRules = parseRouteRules({
    routes: [
      { src: '^/git$', has: host, dest: '/.git/config' },
      { src: '^/escape$', has: host, dest: '/../secret.txt' },
    ],
  });
  const server = createStaticServer(path.join(base, 'root'), { routeRules });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  assert.equal((await get(port, '/git', 'abundancestack.localhost')).status, 404);
  const escape = await get(port, '/escape', 'abundancestack.localhost');
  assert.equal(escape.status, 404);
  assert.doesNotMatch(escape.body, /outside/);
  assert.equal((await get(port, '/', 'abundancestack.localhost')).body, 'home');
});
