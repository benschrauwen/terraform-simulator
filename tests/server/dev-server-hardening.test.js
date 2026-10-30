import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function makeTempRoot(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dev-server-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });

  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><p>home</p>');
  fs.writeFileSync(path.join(root, 'app.mjs'), 'export const ok = true;\n');
  fs.writeFileSync(path.join(root, '.git', 'config'), '[core]\n');
  fs.writeFileSync(path.join(root, '.DS_Store'), 'junk');
  fs.writeFileSync(path.join(root, 'sub', '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside secret');
  fs.writeFileSync(path.join(root, 'sub', 'inside.txt'), 'inside ok');

  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'));
  fs.symlinkSync(outside, path.join(root, 'escape-dir'));
  fs.symlinkSync(path.join(root, 'sub', 'inside.txt'), path.join(root, 'inside-link.txt'));
  fs.symlinkSync(path.join(root, '.git', 'config'), path.join(root, 'git-config-link'));

  return root;
}

async function startServer(t, root) {
  const { startStaticServer } = await import('../../scripts/dev.mjs');
  const { server, port, host } = await startStaticServer({ rootArgument: root, port: 0, host: '127.0.0.1' });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { server, port, host };
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      })
      .on('error', reject);
  });
}

function rawRequest(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => socket.end(payload));
    const chunks = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

test('dotfiles and dot-directories are rejected with 404', async t => {
  const { resolveStaticPath } = await import('../../scripts/dev.mjs');
  const root = makeTempRoot(t);

  for (const urlPath of ['/.git/config', '/.DS_Store', '/sub/.env', '/%2egit/config', '/sub/..%2f.git/config', '/.git/']) {
    assert.equal(resolveStaticPath(root, urlPath).status, 404, urlPath);
  }

  const { port } = await startServer(t, root);
  for (const urlPath of ['/.git/config', '/.DS_Store', '/sub/.env', '/%2Egit/config']) {
    const result = await get(port, urlPath);
    assert.equal(result.status, 404, urlPath);
    assert.equal(result.body, 'Not found');
  }

  const ok = await get(port, '/sub/inside.txt');
  assert.equal(ok.status, 200);
  assert.equal(ok.body, 'inside ok');
});

test('symlinks resolving outside the root (or to hidden files) are not served', async t => {
  const { isRealPathInsideRoot } = await import('../../scripts/dev.mjs');
  const root = makeTempRoot(t);

  assert.equal(await isRealPathInsideRoot(root, path.join(root, 'escape.txt')), false);
  assert.equal(await isRealPathInsideRoot(root, path.join(root, 'inside-link.txt')), true);

  const { port } = await startServer(t, root);

  for (const urlPath of ['/escape.txt', '/escape-dir/secret.txt', '/git-config-link']) {
    const result = await get(port, urlPath);
    assert.equal(result.status, 404, urlPath);
    assert.doesNotMatch(result.body, /outside secret|\[core\]/);
  }

  const inside = await get(port, '/inside-link.txt');
  assert.equal(inside.status, 200);
  assert.equal(inside.body, 'inside ok');
});

test('malformed Host headers and request targets get 400 without crashing the server', async t => {
  const root = makeTempRoot(t);
  const { port } = await startServer(t, root);

  const badHost = await rawRequest(port, 'GET / HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n');
  assert.match(badHost, /^HTTP\/1\.1 400 /);

  const badTarget = await rawRequest(port, 'GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  assert.match(badTarget, /^HTTP\/1\.1 400 /);

  const followUp = await get(port, '/');
  assert.equal(followUp.status, 200);
  assert.match(followUp.body, /home/);
});

test('responses carry security headers and .mjs is served as JavaScript', async t => {
  const { getContentType } = await import('../../scripts/dev.mjs');
  assert.equal(getContentType('module.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(getContentType('font.woff2'), 'font/woff2');
  assert.equal(getContentType('marker.png'), 'image/png');

  const root = makeTempRoot(t);
  const { port } = await startServer(t, root);

  const ok = await get(port, '/app.mjs');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');

  const missing = await get(port, '/nope.js');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers['x-content-type-options'], 'nosniff');
});

test('server binds to loopback by default', async t => {
  const { startStaticServer, DEFAULT_HOST } = await import('../../scripts/dev.mjs');
  assert.equal(DEFAULT_HOST, '127.0.0.1');

  const root = makeTempRoot(t);
  const previousHost = process.env.HOST;
  delete process.env.HOST;
  t.after(() => {
    if (previousHost !== undefined) process.env.HOST = previousHost;
  });

  const { server, host } = await startStaticServer({ rootArgument: root, port: 0 });
  t.after(() => new Promise(resolve => server.close(resolve)));

  assert.equal(host, '127.0.0.1');
  assert.equal(server.address().address, '127.0.0.1');
});
