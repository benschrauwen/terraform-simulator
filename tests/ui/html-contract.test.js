import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function tags(name) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, 'i'));
  return match ? match[2] : '';
}

function assertId(id) {
  assert.match(html, new RegExp(`\\bid=(["'])${id}\\1`), `Expected #${id} to exist in index.html.`);
}

test('static app shell exposes required control and output anchors', () => {
  [
    'resetStateButton',
    'headerActionStatus',
    'headerMetrics',
    'metricCapex',
    'metricRevenue',
    'metricPayback',
    'metricIrrLabel',
    'metricIRR',
    'metricViability',
    'metricViabilityValue',
    'mobilePaneBar',
    'configPanel',
    'diagramArea',
    'resultsPanel',
    'dayModeTabs',
    'daySpecificControls',
    'dayOfYear',
    'locationPreset',
    'saveSitePresetWrap',
    'saveSitePresetName',
    'saveSitePresetButton',
    'removeSavedSitePresetButton',
    'latitude',
    'longitude',
    'siteYield',
    'systemSize',
    'mountingType',
    'batteryCapacity',
    'loadConfigTabs',
    'aiComputeEnabled',
    'policyMode',
    'policyInputControls',
    'financingEnabled',
    'financingConfig',
    'diagramContainer',
    'siteMap',
    'siteMapEmpty',
    'powerChart',
    'annualDispatchChart',
    'economicsTimelineChart',
    'cashFlowDetails',
    'cashFlowSummary',
    'cashFlowNote',
    'cashFlowCsvButton',
    'cashFlowTableScroll',
    'plantScoreCard',
    'productionGrid',
    'econBreakdown',
    'econChart',
    'sensitivityEmptyState',
    'impactGrid',
  ].forEach(assertId);
});

test('interactive buttons declare button type and mobile pane targets exist', () => {
  tags('button').forEach(button => {
    assert.equal(attr(button, 'type'), 'button', `Expected explicit type="button" on ${button}`);
  });

  tags('button')
    .filter(button => button.includes('mobile-pane-toggle'))
    .forEach(button => {
      const target = attr(button, 'data-panel-target');
      assert.ok(target, `Expected mobile pane target on ${button}`);
      assertId(target);
      assert.equal(attr(button, 'aria-controls'), target, `Expected aria-controls to match ${target}.`);
      assert.match(attr(button, 'aria-expanded'), /^(true|false)$/);
    });
});

test('analysis cycle mode buttons expose toggle state and controlled details', () => {
  const modeGroup = tags('div').find(div => attr(div, 'id') === 'dayModeTabs');
  assert.ok(modeGroup, 'Expected #dayModeTabs to exist.');
  assert.equal(attr(modeGroup, 'role'), 'group');
  assert.ok(attr(modeGroup, 'aria-label'));

  tags('button')
    .filter(button => button.includes('day-tab'))
    .forEach(button => {
      assert.match(attr(button, 'aria-pressed'), /^(true|false)$/);
      assert.equal(attr(button, 'aria-controls'), 'daySpecificControls');
    });

  const specificControls = tags('div').find(div => attr(div, 'id') === 'daySpecificControls');
  assert.ok(specificControls, 'Expected #daySpecificControls to exist.');
  assert.match(specificControls, /\shidden(?:\s|>|=)/i);
  assert.equal(attr(specificControls, 'aria-hidden'), 'true');
});

test('load configuration tabs expose a complete tablist contract', () => {
  const loadTabs = tags('button').filter(button => button.includes('load-config-tab'));
  assert.equal(loadTabs.length, 2);

  loadTabs.forEach(button => {
    const tabId = attr(button, 'id');
    const target = attr(button, 'aria-controls');
    assert.ok(tabId, `Expected tab id on ${button}`);
    assert.ok(target, `Expected aria-controls on ${button}`);
    assert.equal(attr(button, 'role'), 'tab', `Expected role="tab" on ${button}`);
    assert.match(attr(button, 'aria-selected'), /^(true|false)$/);
    assert.match(attr(button, 'tabindex'), /^(?:-1|0)$/);
    assertId(target);

    const panel = tags('div').find(div => attr(div, 'id') === target);
    assert.ok(panel, `Expected panel ${target} to exist.`);
    assert.equal(attr(panel, 'role'), 'tabpanel');
    assert.equal(attr(panel, 'aria-labelledby'), tabId);
  });
});

test('external links opened in new tabs declare a safe rel attribute', () => {
  tags('a')
    .filter(anchor => attr(anchor, 'target') === '_blank')
    .forEach(anchor => {
      const relTokens = new Set(attr(anchor, 'rel').toLowerCase().split(/\s+/).filter(Boolean));
      assert.equal(
        relTokens.has('noopener') || relTokens.has('noreferrer'),
        true,
        `Expected target=_blank link to include noopener or noreferrer: ${anchor}`
      );
    });
});

test('index.html loads one module entry plus classic vendor scripts', () => {
  const scripts = tags('script');
  const moduleScripts = scripts.filter(script => attr(script, 'type') === 'module');
  assert.deepEqual(moduleScripts.map(script => attr(script, 'src')), ['js/main.js']);

  const classicScripts = scripts.filter(script => attr(script, 'type') !== 'module');
  classicScripts.forEach(script => {
    assert.ok(attr(script, 'src'), `Expected no inline scripts: ${script}`);
  });
  assert.deepEqual(classicScripts.map(script => attr(script, 'src')), [
    'node_modules/chart.js/dist/chart.umd.js',
    'node_modules/lz-string/libs/lz-string.min.js',
    'node_modules/leaflet/dist/leaflet.js',
  ]);
  assert.ok(
    html.indexOf('node_modules/lz-string/libs/lz-string.min.js') < html.indexOf('js/main.js'),
    'Expected LZString to load before the module entry.'
  );
});

test('index.html only references local assets that exist and declares no inline handlers', () => {
  const urls = [...tags('script'), ...tags('link')]
    .map(tag => attr(tag, 'src') || attr(tag, 'href'))
    .filter(Boolean);

  assert.ok(urls.length > 0);
  urls.forEach(url => {
    assert.doesNotMatch(url, /^(?:[a-z]+:)?\/\//i, `Expected self-hosted asset, got ${url}`);
    assert.equal(fs.existsSync(path.join(ROOT, url)), true, `Expected ${url} to exist.`);
  });
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'Expected no inline event handler attributes (blocked by CSP).');
});

/* datacenter.html: the Abundance Stack page shares the shell conventions above. */
const datacenterHtml = fs.readFileSync(path.join(ROOT, 'datacenter.html'), 'utf8');
const datacenterTags = name => datacenterHtml.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
const hasDatacenterId = id => new RegExp(`\\bid=(["'])${id}\\1`).test(datacenterHtml);

test('datacenter.html exposes the section and output anchors the datacenter UI fills', () => {
  const missing = [
    'resetStateButton', 'headerActionStatus', 'headerMetrics', 'mobilePaneBar',
    'configPanel', 'diagramArea', 'resultsPanel',
    'siteControls', 'datacenterControls', 'coolingControls', 'architectureControls', 'gridControls',
    'solarControls', 'batteryControls', 'gasControls', 'revenueControls', 'financeControls',
    'layoutView', 'flowTabs', 'flowView', 'flowNote', 'dispatchChart', 'dispatchNote',
    'economicsTimelineChart', 'economicsTimelineMode', 'economicsTimelineNote',
    'cashFlowDetails', 'cashFlowSummary', 'cashFlowNote', 'cashFlowCsvButton', 'cashFlowTableScroll',
    'keyMetrics', 'econBreakdown', 'sensitivityResults', 'appVersion',
    // Optimize Design card (optimizer-panel.js).
    'optimizerSizeSolar', 'optimizerSizeBattery', 'optimizerSizeFirm', 'optimizerSizeGrid', 'optimizerCompare',
    'optimizerWide', 'optimizerRunButton', 'optimizerProgress', 'optimizerStatus', 'optimizerStale', 'optimizerResults',
  ].filter(id => !hasDatacenterId(id));
  assert.deepEqual(missing, []);

  const ids = [...datacenterHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), [], 'Expected unique ids.');
  // Visible text only: the GitHub repository URL keeps its historical name.
  const visibleText = datacenterHtml.replace(/<!--[\s\S]*?-->|<[^>]*>/g, ' ');
  assert.doesNotMatch(visibleText, /Terraform/i, 'The Abundance Stack site carries no Terraform branding.');
});

test('datacenter.html flow tabs expose a complete tablist contract', () => {
  const flowTabs = datacenterTags('button').filter(button => button.includes('data-flow='));
  assert.deepEqual(flowTabs.map(button => attr(button, 'data-flow')), ['electricity', 'heat', 'water', 'co2']);
  flowTabs.forEach(button => {
    assert.equal(attr(button, 'role'), 'tab');
    assert.equal(attr(button, 'aria-controls'), 'flowView');
    assert.match(attr(button, 'aria-selected'), /^(true|false)$/);
    assert.match(attr(button, 'tabindex'), /^(?:-1|0)$/);
  });
  const panel = datacenterTags('div').find(div => attr(div, 'id') === 'flowView');
  assert.equal(attr(panel, 'role'), 'tabpanel');
  assert.equal(attr(panel, 'aria-labelledby'), attr(flowTabs.find(button => attr(button, 'aria-selected') === 'true'), 'id'));
});

test('datacenter.html plant layout Map | Diagram tabs control their own panels', () => {
  const layoutTabs = datacenterTags('button').filter(button => button.includes('data-layout-view='));
  assert.deepEqual(layoutTabs.map(button => attr(button, 'data-layout-view')), ['map', 'diagram']);
  layoutTabs.forEach(button => {
    assert.equal(attr(button, 'role'), 'tab');
    const panelId = attr(button, 'aria-controls');
    const panel = datacenterTags('div').find(div => attr(div, 'id') === panelId);
    assert.ok(panel, `#${panelId}`);
    assert.equal(attr(panel, 'role'), 'tabpanel');
    assert.equal(attr(panel, 'aria-labelledby'), attr(button, 'id'));
  });
  // The diagram is the initial view; the map panel starts hidden.
  assert.equal(attr(layoutTabs.find(button => attr(button, 'aria-selected') === 'true'), 'data-layout-view'), 'diagram');
  assert.match(datacenterTags('div').find(div => attr(div, 'id') === 'layoutMapPanel'), /\shidden\b/);
  ['plantMap', 'plantMapNote', 'layoutDiagram', 'layoutLegend', 'layoutNotes'].forEach(id => assert.ok(hasDatacenterId(id), `#${id}`));
});

test('datacenter.html buttons, mobile pane targets and new-tab links follow the shell rules', () => {
  datacenterTags('button').forEach(button => {
    assert.equal(attr(button, 'type'), 'button', `Expected explicit type="button" on ${button}`);
  });
  datacenterTags('button')
    .filter(button => button.includes('mobile-pane-toggle'))
    .forEach(button => {
      const target = attr(button, 'data-panel-target');
      assert.ok(hasDatacenterId(target), `Expected #${target}`);
      assert.equal(attr(button, 'aria-controls'), target);
    });
  datacenterTags('a')
    .filter(anchor => attr(anchor, 'target') === '_blank')
    .forEach(anchor => assert.match(attr(anchor, 'rel'), /\bno(?:opener|referrer)\b/, anchor));
});

test('datacenter.html loads one module entry plus the same classic vendor scripts', () => {
  const scripts = datacenterTags('script');
  assert.deepEqual(scripts.filter(script => attr(script, 'type') === 'module').map(script => attr(script, 'src')), ['js/datacenter-main.js']);
  const classicScripts = scripts.filter(script => attr(script, 'type') !== 'module');
  classicScripts.forEach(script => assert.ok(attr(script, 'src'), `Expected no inline scripts: ${script}`));
  assert.deepEqual(classicScripts.map(script => attr(script, 'src')), [
    'node_modules/chart.js/dist/chart.umd.js',
    'node_modules/lz-string/libs/lz-string.min.js',
    'node_modules/leaflet/dist/leaflet.js',
  ]);
});

test('every page only references local assets that exist and declares no inline handlers', () => {
  ['index.html', 'sources.html', 'datacenter.html', 'datacenter-sources.html'].forEach(page => {
    const pageHtml = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const urls = [...pageHtml.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/gi)].map(match => match[1]);
    assert.ok(urls.length > 0, page);
    urls.forEach(url => {
      assert.doesNotMatch(url, /^(?:[a-z]+:)?\/\//i, `${page}: expected self-hosted asset, got ${url}`);
      assert.equal(fs.existsSync(path.join(ROOT, url)), true, `${page}: expected ${url} to exist.`);
    });
    assert.doesNotMatch(pageHtml, /\son[a-z]+=/i, `${page}: no inline event handlers (blocked by CSP).`);
    assert.doesNotMatch(pageHtml, /<script\b(?![^>]*\bsrc=)[^>]*>/i, `${page}: no inline scripts (blocked by CSP).`);
    const localLinks = [...pageHtml.matchAll(/<a\b[^>]*\bhref="([^"#:]+\.html)(?:#[^"]*)?"/g)].map(match => match[1]);
    localLinks.forEach(link => assert.equal(fs.existsSync(path.join(ROOT, link)), true, `${page}: link to missing ${link}`));
  });
});
