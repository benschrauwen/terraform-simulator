const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
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

test('script order preserves runtime dependencies', () => {
  const scripts = tags('script').map(script => attr(script, 'src')).filter(Boolean);
  const indexOf = src => {
    const index = scripts.indexOf(src);
    assert.notEqual(index, -1, `Expected script ${src} to be present.`);
    return index;
  };
  const before = (left, right) => {
    assert.ok(indexOf(left) < indexOf(right), `Expected ${left} to load before ${right}.`);
  };

  before('node_modules/lz-string/libs/lz-string.min.js', 'js/share-state.js');
  before('js/module-catalog.js', 'js/state-schema.js');
  before('js/state-schema.js', 'js/calculations/calculations-core.js');
  before('js/calculations/calculations-core.js', 'js/calculations/calculations-solar.js');
  before('js/calculations/calculations-core.js', 'js/calculations/calculations-battery.js');
  before('js/calculations/calculations-core.js', 'js/calculations/calculations-process.js');
  before('js/calculations/calculations-process.js', 'js/calculations/calculations-economics.js');
  before('js/calculations/calculations-economics.js', 'js/diagram.js');
  before('js/diagram.js', 'js/app.js');
  before('js/app.js', 'js/app-share-state.js');
  before('js/app.js', 'js/app-controls.js');
  before('js/app.js', 'js/app-optimizer.js');
  before('js/app.js', 'js/app-ui-state.js');
  before('js/app.js', 'js/app-site-map.js');
  before('js/app.js', 'js/app-renderers.js');
  before('js/app.js', 'js/app-charts.js');
});
