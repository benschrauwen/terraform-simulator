/*
 * Boot smoke test: serve the repo with scripts/dev.mjs, load index.html and the
 * host-routed datacenter page in headless Chrome over the DevTools protocol
 * (Node's built-in WebSocket), and check each boots without console errors.
 *
 * Skipped (never failed) when no Chrome/Chromium is found. Set CHROME_PATH
 * to point at a specific binary.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startStaticServer } from '../../scripts/dev.mjs';

const BOOT_TIMEOUT_MS = 20000;

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (found) return found;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const which = spawnSync('which', [name], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  }
  return null;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await delay(100);
  }
}

/* Minimal CDP client over one browser WebSocket with flattened sessions. */
function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    listeners.forEach(listener => listener(message));
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('error', () => reject(new Error('DevTools WebSocket failed')));
    socket.addEventListener('open', () => resolve({
      send(method, params = {}, sessionId) {
        const id = nextId++;
        socket.send(JSON.stringify({ id, method, params, sessionId }));
        return new Promise((done, fail) => pending.set(id, { resolve: done, reject: fail }));
      },
      onEvent(listener) {
        listeners.push(listener);
      },
      close() {
        socket.close();
      },
    }));
  });
}

const chromePath = findChrome();

/*
 * Serve the repo, start headless Chrome and open `url(origin, port)` in a fresh tab.
 * Returns an evaluate() helper and the list of console errors collected so far.
 */
async function openPage(t, url) {
  const { server, port } = await startStaticServer({ port: 0, host: '127.0.0.1' });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-boot-smoke-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: 'ignore' });
  let client = null;
  t.after(async () => {
    client?.close();
    chrome.kill('SIGKILL');
    server.close();
    await delay(100);
    fs.rmSync(profileDir, { recursive: true, force: true });
  });

  const activePortFile = path.join(profileDir, 'DevToolsActivePort');
  const [debugPort, browserPath] = (await waitFor(
    () => fs.existsSync(activePortFile) && fs.readFileSync(activePortFile, 'utf8').trim().split('\n'),
    BOOT_TIMEOUT_MS,
    'DevToolsActivePort'
  ));
  client = await connect(`ws://127.0.0.1:${debugPort}${browserPath}`);

  const pageUrl = url(port);
  const origin = new URL(pageUrl).origin;
  const errors = [];
  client.onEvent(({ method, params }) => {
    if (method === 'Runtime.exceptionThrown') {
      errors.push(`exception: ${params.exceptionDetails?.exception?.description || params.exceptionDetails?.text}`);
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      errors.push(`console.error: ${params.args.map(arg => arg.value ?? arg.description).join(' ')}`);
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      // Map tiles come from the internet; their failures are not app errors.
      const entryUrl = params.entry.url || '';
      if (params.entry.source === 'network' && entryUrl && !entryUrl.startsWith(origin)) return;
      // The app ships no favicon; Chrome's automatic probe races page load.
      if (params.entry.source === 'network' && entryUrl === `${origin}/favicon.ico`) return;
      errors.push(`log: ${params.entry.text} ${entryUrl}`);
    }
  });

  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Log.enable', {}, sessionId);
  await client.send('Page.enable', {}, sessionId);
  await client.send('Page.navigate', { url: pageUrl }, sessionId);

  const evaluate = async expression => (await client.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)).result.value;
  return { evaluate, errors };
}

const chromeOptions = {
  skip: chromePath ? false : 'Chrome/Chromium not found (set CHROME_PATH to run the boot smoke test)',
  timeout: BOOT_TIMEOUT_MS + 10000,
};

test('the app boots in headless Chrome, renders CAPEX and logs no errors', chromeOptions, async t => {
  const { evaluate, errors } = await openPage(t, port => `http://127.0.0.1:${port}/index.html`);
  const capexText = await waitFor(async () => {
    const text = await evaluate("document.getElementById('metricCapex')?.textContent || ''");
    return /\$\s*[1-9]/.test(text) ? text : null;
  }, BOOT_TIMEOUT_MS, 'the CAPEX metric to render');
  assert.match(capexText, /^\$[\d.,]+\s*[KMB]?$/, `CAPEX metric "${capexText}"`);

  assert.match(await evaluate("document.getElementById('metricRevenue').textContent"), /^\$\s*[1-9]/);
  // Let deferred renders (charts, diagram) run before checking for errors.
  await delay(500);
  assert.deepEqual(errors, []);
});

test('abundancestack.localhost serves the datacenter page, which boots, renders real results and logs no errors', chromeOptions, async t => {
  // Chrome resolves *.localhost to loopback; the dev server routes it like abundancestack.com.
  const { evaluate, errors } = await openPage(t, port => `http://abundancestack.localhost:${port}/`);
  await waitFor(
    async () => (await evaluate("document.readyState === 'complete' && Boolean(window.app)")),
    BOOT_TIMEOUT_MS,
    'the datacenter app to boot'
  );
  assert.match(await evaluate('document.title'), /^Abundance Stack/);
  assert.equal(await evaluate('location.pathname'), '/');
  assert.equal(await evaluate("typeof Chart === 'function' && typeof LZString === 'object' && typeof L === 'object'"), true);

  // Real numbers render: annual PUE and total CAPEX in the key metrics, the first-power date in the header.
  const metrics = await waitFor(async () => {
    const text = await evaluate("document.getElementById('keyMetrics')?.innerText || ''");
    return /Annual PUE\s+1\.\d{3}/i.test(text) && /Total CAPEX\s+\$[\d.]+[KMB]/i.test(text) ? text : null;
  }, BOOT_TIMEOUT_MS, 'the key metrics to render');
  assert.match(metrics, /Uptime achieved\s+[\d.]+%/i);
  assert.match(await evaluate("document.getElementById('headerMetrics').innerText"), /First power\s+[A-Z][a-z]{2} 20\d\d/);
  // The views and charts draw: plant layout, Sankey, timeline (one critical path), dispatch chart.
  assert.ok(await evaluate("document.querySelectorAll('#layoutView .pl-block').length") >= 3);
  assert.ok(await evaluate("document.querySelectorAll('#flowView .sk-band').length") >= 2);
  assert.equal(await evaluate("document.querySelectorAll('#timelineView [data-critical=\"true\"]').length"), 1);
  assert.equal(await evaluate("Boolean(window.app.charts.dispatch && window.app.charts.econTimeline)"), true);
  // Controls are generated and drive the model: switching to islanded hides the grid section.
  await evaluate("(() => { const radio = document.querySelector('input[name=\"architecture\"][value=\"islanded\"]'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); })()");
  assert.equal(await evaluate("document.querySelector('[data-section=\"grid\"]').hidden"), true);
  assert.match(await evaluate("document.getElementById('timelineHeadline').textContent"), /^Slowest path: /);
  // The tornado (debounced) renders after the first paint.
  await waitFor(async () => (await evaluate("window.app.lastTornado?.bars?.length || 0")) > 3, BOOT_TIMEOUT_MS, 'the tornado');
  await delay(500);
  assert.deepEqual(errors, []);
});
