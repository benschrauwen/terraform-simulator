const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function createMockResponse() {
  let statusCode = null;
  let headers = null;
  let body = null;
  let resolveDone;
  const done = new Promise(resolve => {
    resolveDone = resolve;
  });

  return {
    done,
    response: {
      writeHead(code, nextHeaders) {
        statusCode = code;
        headers = nextHeaders;
      },
      end(nextBody) {
        body = Buffer.isBuffer(nextBody) ? nextBody : Buffer.from(String(nextBody || ''));
        resolveDone({ statusCode, headers, body });
      },
    },
  };
}

test('static path resolution stays inside the configured root', async () => {
  const {
    getContentType,
    isPathInsideRoot,
    resolveFilePath,
    resolveStaticPath,
  } = await import('../../scripts/dev.mjs');

  const rootRequest = resolveStaticPath(ROOT, '/');
  assert.equal(rootRequest.status, 200);
  assert.equal(rootRequest.candidatePath, path.join(ROOT, 'index.html'));

  const encodedTraversal = resolveStaticPath(ROOT, '/%2e%2e/%2e%2e/etc/passwd');
  assert.equal(encodedTraversal.status, 200);
  assert.equal(isPathInsideRoot(ROOT, encodedTraversal.candidatePath), true);
  assert.equal(encodedTraversal.candidatePath, path.join(ROOT, 'etc/passwd'));

  const siblingPath = path.resolve(ROOT, '../terraform-industries-copy/index.html');
  assert.equal(isPathInsideRoot(ROOT, siblingPath), false);

  const malformedEscape = resolveStaticPath(ROOT, '/%E0%A4%A');
  assert.equal(malformedEscape.status, 400);
  assert.equal(malformedEscape.candidatePath, null);

  assert.equal(getContentType('style.css'), 'text/css; charset=utf-8');
  assert.equal(getContentType('diagram.svg'), 'image/svg+xml; charset=utf-8');
  assert.equal(getContentType('unknown.bin'), 'application/octet-stream');

  assert.equal(await resolveFilePath(ROOT), path.join(ROOT, 'index.html'));
  assert.equal(await resolveFilePath(path.join(ROOT, 'missing-file.txt')), null);
});

test('static request responses include expected status, MIME, and cache headers', async () => {
  const { serveStaticRequest } = await import('../../scripts/dev.mjs');

  const ok = createMockResponse();
  await serveStaticRequest({ url: '/style.css', headers: { host: 'localhost' } }, ok.response, ROOT);
  const okResult = await ok.done;
  assert.equal(okResult.statusCode, 200);
  assert.equal(okResult.headers['Cache-Control'], 'no-store');
  assert.equal(okResult.headers['Content-Type'], 'text/css; charset=utf-8');
  assert.match(okResult.body.toString('utf8'), /:root|body|\*/);

  const missing = createMockResponse();
  await serveStaticRequest({ url: '/missing-file.js', headers: { host: 'localhost' } }, missing.response, ROOT);
  const missingResult = await missing.done;
  assert.equal(missingResult.statusCode, 404);
  assert.equal(missingResult.headers['Content-Type'], 'text/plain; charset=utf-8');
  assert.equal(missingResult.body.toString('utf8'), 'Not found');

  const badRequest = createMockResponse();
  await serveStaticRequest({ url: '/%E0%A4%A', headers: { host: 'localhost' } }, badRequest.response, ROOT);
  const badRequestResult = await badRequest.done;
  assert.equal(badRequestResult.statusCode, 400);
  assert.equal(badRequestResult.body.toString('utf8'), 'Bad request');
});
