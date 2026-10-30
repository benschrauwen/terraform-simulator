import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

// URLs that are app plumbing rather than source material.
const NOT_SOURCES = [
  /^https?:\/\/(?:127\.0\.0\.1|localhost)\b/,
  /^http:\/\/www\.w3\.org\//,
  /\{[xyz]\}/, // map tile URL template
];

function listJsFiles(directory) {
  return fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap(entry => {
    const relativePath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return listJsFiles(relativePath);
    return entry.name.endsWith('.js') ? [relativePath] : [];
  });
}

function extractUrls(text) {
  return [...text.matchAll(/https?:\/\/[^\s"'<>)`]+/g)]
    .map(match => match[0].replace(/[.,;:]+$/, ''))
    .filter(url => !NOT_SOURCES.some(pattern => pattern.test(url)));
}

test('the sources page lists every URL cited in the code, README and app page', () => {
  const sourcesPage = read('sources.html').replaceAll('&amp;', '&');
  const citingFiles = [...listJsFiles('js'), 'README.md', 'index.html'];
  const missing = citingFiles.flatMap(file => (
    extractUrls(read(file))
      .filter(url => !sourcesPage.includes(url))
      .map(url => `${file}: ${url}`)
  ));

  assert.deepEqual([...new Set(missing)], [], 'Add these sources to sources.html');
});

test('the sources page links out over https and is reachable from the app footer', () => {
  const sourcesPage = read('sources.html');
  const externalLinks = [...sourcesPage.matchAll(/href="(https?:[^"]+)"/g)].map(match => match[1]);
  assert.ok(externalLinks.length > 50);
  assert.deepEqual(externalLinks.filter(url => !url.startsWith('https://')), []);
  assert.match(read('index.html'), /<footer[\s\S]*href="sources\.html"[\s\S]*<\/footer>/);
  assert.match(sourcesPage, /href="index\.html"/);
});
