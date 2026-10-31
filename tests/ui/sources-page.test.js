import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

// URLs that are app plumbing rather than source material.
const NOT_SOURCES = [
  /^https?:\/\/(?:127\.0\.0\.1|localhost|[\w.-]+\.localhost)\b/,
  /^http:\/\/www\.w3\.org\//,
  /\{[xyz]\}/, // map tile URL template
];

// Two sites share the repo: the Abundance Stack datacenter simulator cites its sources
// on datacenter-sources.html, everything else on sources.html.
const DATACENTER_DIRS = ['js/data/datacenter', 'js/model/datacenter', 'js/ui/datacenter'];
const DATACENTER_FILES = ['js/datacenter-main.js', 'datacenter.html'];
const isDatacenterFile = file => DATACENTER_FILES.includes(file) || DATACENTER_DIRS.some(dir => file.startsWith(`${dir}/`));

function listJsFiles(directory) {
  if (!fs.existsSync(path.join(ROOT, directory))) return [];
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

function missingSources(sourcesFile, citingFiles) {
  const sourcesPage = read(sourcesFile).replaceAll('&amp;', '&');
  return [...new Set(citingFiles.flatMap(file => (
    extractUrls(read(file))
      .filter(url => !sourcesPage.includes(url))
      .map(url => `${file}: ${url}`)
  )))];
}

test('the sources page lists every URL cited in the code, README and app page', () => {
  const citingFiles = [...listJsFiles('js').filter(file => !isDatacenterFile(file)), 'README.md', 'index.html'];
  assert.deepEqual(missingSources('sources.html', citingFiles), [], 'Add these sources to sources.html');
});

test('the datacenter sources page lists every URL cited in the datacenter code and page', () => {
  const citingFiles = [...listJsFiles('js').filter(isDatacenterFile), ...DATACENTER_FILES];
  assert.ok(citingFiles.includes('js/ui/datacenter/app.js'));
  assert.deepEqual(missingSources('datacenter-sources.html', [...new Set(citingFiles)]), [], 'Add these sources to datacenter-sources.html');
});

test('the sources page links out over https and is reachable from the app footer', () => {
  const sourcesPage = read('sources.html');
  const externalLinks = [...sourcesPage.matchAll(/href="(https?:[^"]+)"/g)].map(match => match[1]);
  assert.ok(externalLinks.length > 50);
  assert.deepEqual(externalLinks.filter(url => !url.startsWith('https://')), []);
  assert.match(read('index.html'), /<footer[\s\S]*href="sources\.html"[\s\S]*<\/footer>/);
  assert.match(sourcesPage, /href="index\.html"/);
});

test('the datacenter sources page links out over https and is reachable from the datacenter footer', () => {
  const sourcesPage = read('datacenter-sources.html');
  const externalLinks = [...sourcesPage.matchAll(/href="(https?:[^"]+)"/g)].map(match => match[1]);
  assert.ok(externalLinks.length > 0);
  assert.deepEqual(externalLinks.filter(url => !url.startsWith('https://')), []);
  [...sourcesPage.matchAll(/<a\b[^>]*href="https:[^>]*>/g)].forEach(([anchor]) => {
    assert.match(anchor, /target="_blank" rel="noreferrer"/, anchor);
  });
  assert.match(read('datacenter.html'), /<footer[\s\S]*href="datacenter-sources\.html"[\s\S]*<\/footer>/);
  assert.match(sourcesPage, /href="datacenter\.html"/);
  // The two sites stay separate: no cross links between their pages.
  assert.doesNotMatch(sourcesPage, /href="(?:index|sources)\.html"/);
  assert.doesNotMatch(read('datacenter.html'), /href="(?:index|sources)\.html"/);
});
