/*
 * Imports run one way: data -> state -> model -> ui (and workers, which run
 * the model). A layer may import its own files, any lower layer and the
 * dependency-free js/util.js, never a higher layer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JS_ROOT = fileURLToPath(new URL('../../js/', import.meta.url));
const LAYERS = ['data', 'state', 'model', 'ui', 'workers'];
const RANK = { util: -1, data: 0, state: 1, model: 2, ui: 3, workers: 3 };

function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

function layerOf(file) {
  const relative = path.relative(JS_ROOT, file).split(path.sep);
  if (relative.length === 1) return relative[0] === 'util.js' ? 'util' : 'entry';
  return relative[0];
}

test('js/ imports only flow from lower layers to higher ones', () => {
  const violations = [];
  LAYERS.forEach(layer => {
    listJsFiles(path.join(JS_ROOT, layer)).forEach(file => {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/^\s*(?:import|export)\s[^'"]*from\s+'([^']+)'/gm)) {
        const target = path.resolve(path.dirname(file), match[1]);
        const targetLayer = layerOf(target);
        if (!(targetLayer in RANK)) {
          violations.push(`${path.relative(JS_ROOT, file)} imports ${match[1]} (outside the layers)`);
        } else if (RANK[targetLayer] > RANK[layer] || (layer === 'workers' && targetLayer === 'ui')) {
          violations.push(`${path.relative(JS_ROOT, file)} (${layer}) imports ${match[1]} (${targetLayer})`);
        }
      }
    });
  });
  assert.deepEqual(violations, []);
});

test('js/util.js imports nothing', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(JS_ROOT, 'util.js'), 'utf8'), /^\s*import\s/m);
});
