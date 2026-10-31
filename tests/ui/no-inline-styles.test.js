/*
 * vercel.json's CSP has no 'unsafe-inline' in style-src, so the browser drops any
 * style="" attribute parsed from HTML (index.html or innerHTML strings). Inline
 * styles must be set through CSSOM (element.style.x = ...) or replaced by classes
 * or the hidden attribute.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function listJsFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJsFiles(fullPath);
    return entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

test('the CSP forbids inline styles', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const csp = config.routes.map(route => route.headers?.['Content-Security-Policy']).find(Boolean);
  const styleSrc = csp.split(';').map(part => part.trim()).find(part => part.startsWith('style-src '));
  assert.equal(styleSrc, "style-src 'self'");
});

test('no markup in the HTML pages or js/ carries a style attribute or <style> element', () => {
  const pages = ['index.html', 'sources.html', 'datacenter.html', 'datacenter-sources.html'];
  const files = [...pages.map(page => path.join(ROOT, page)), ...listJsFiles(path.join(ROOT, 'js'))];
  const offenders = files.flatMap(file => fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /\sstyle\s*=\s*["'`$]|<style\b|setAttribute\(\s*['"]style['"]/i.test(line))
    .map(({ number }) => `${path.relative(ROOT, file)}:${number}`));
  assert.deepEqual(offenders, []);
});
