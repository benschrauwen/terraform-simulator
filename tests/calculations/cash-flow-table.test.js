import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCashFlowCsv, buildCashFlowTable } from '../../js/model/cash-flow-table.js';
import { runScenario } from './harness.js';

const SCENARIOS = {
  default: {},
  financing: { financingEnabled: true },
  horizon40: { analysisHorizonYears: 40 },
  ai: { aiComputeEnabled: true },
  // The default 45V pays operating credits; 48E is an ITC at close instead.
  noPolicy: { policyMode: 'none' },
  itc: { policyMode: 'us_48e_solar' },
};

const close = (actual, expected, relative, label) =>
  assert.ok(Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected)), `${label}: ${actual} vs ${expected}`);

test('the last cumulative discounted cash flow is the NPV', () => {
  Object.entries(SCENARIOS).forEach(([name, overrides]) => {
    const { economics } = runScenario(overrides);
    const table = buildCashFlowTable(economics);
    assert.equal(table.rows.length, economics.yearlyCashFlows.length + 1, `${name}: years 0..N`);
    close(table.rows.at(-1).cumulativeDiscountedCashFlow, economics.npv, 1e-6, name);
  });
});

test('year 0 is net CAPEX at close; equity year 0 is sponsor cash at close', () => {
  Object.entries(SCENARIOS).forEach(([name, overrides]) => {
    const { economics } = runScenario(overrides);
    const [yearZero] = buildCashFlowTable(economics).rows;
    assert.equal(yearZero.netCashFlow, -economics.netCapexAtClose, name);
    assert.equal(yearZero.discountFactor, 1);
    assert.equal(yearZero.equityCashFlow, -economics.financing.equityUpfront, name);
  });
});

test('columns add up: components = net cash flow, net - debt service = equity cash', () => {
  Object.entries(SCENARIOS).forEach(([name, overrides]) => {
    const { economics } = runScenario(overrides);
    const table = buildCashFlowTable(economics);
    const scale = economics.totalCapex;
    table.rows.slice(1).forEach(row => {
      const sum = row.marketRevenue + row.policyCredits + row.operatingCost + row.replacementCapex + row.salvage;
      close(sum, row.netCashFlow, 1e-9 * scale, `${name} year ${row.year}`);
      close(row.netCashFlow + row.debtService, row.equityCashFlow, 1e-9 * scale, `${name} equity ${row.year}`);
      close(row.discountedCashFlow, row.netCashFlow * row.discountFactor, 1e-9 * scale, `${name} discounting`);
      assert.ok(row.operatingCost <= 0 && row.replacementCapex <= 0 && row.salvage >= 0, 'outflows are negative');
    });
    // Operating O&M is the same every year: fixed cost on installed CAPEX.
    table.rows.slice(1).forEach(row => close(-row.operatingCost, economics.annualOM, 1e-12, `${name} O&M`));
  });
});

test('policy-credit and debt columns appear only when they carry cash', () => {
  const plain = buildCashFlowTable(runScenario(SCENARIOS.noPolicy).economics);
  assert.ok(!plain.columns.some(column => column.key === 'policyCredits' || column.key === 'debtService'));
  const credits = buildCashFlowTable(runScenario(SCENARIOS.default).economics);
  assert.ok(credits.hasPolicyCredits);
  assert.ok(credits.columns.some(column => column.key === 'policyCredits'));
  const financed = buildCashFlowTable(runScenario(SCENARIOS.financing).economics);
  assert.ok(financed.columns.some(column => column.key === 'debtService'));
  assert.ok(financed.rows.slice(1).some(row => row.debtService < 0));
});

test('the payback year is the year cumulative cash (without salvage) turns non-negative', () => {
  ['default', 'ai', 'horizon40'].forEach(name => {
    const { economics } = runScenario(SCENARIOS[name]);
    const table = buildCashFlowTable(economics);
    let cumulative = 0;
    let firstRecovered = null;
    table.rows.forEach(row => {
      const before = cumulative;
      cumulative += row.netCashFlow - row.salvage;
      if (firstRecovered === null && row.year > 0 && before < 0 && cumulative >= 0) firstRecovered = row.year;
    });
    assert.equal(table.paybackYear, Number.isFinite(economics.paybackYears) ? firstRecovered : null, name);
  });
});

function parseCsv(text) {
  // Minimal RFC 4180 reader: quoted fields may hold commas, quotes, newlines.
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test('the CSV holds N + 1 year rows that parse back to the same numbers', () => {
  ['default', 'financing', 'noPolicy'].forEach(name => {
    const { economics } = runScenario(SCENARIOS[name]);
    const table = buildCashFlowTable(economics);
    const header = [
      ['Share link', 'https://example.test/#s=a,b"c'],
      ['Discount rate (%)', economics.discountRatePercent],
    ];
    const rows = parseCsv(buildCashFlowCsv(table, header));
    assert.deepEqual(rows[0], ['Share link', 'https://example.test/#s=a,b"c']);
    assert.deepEqual(rows[1], ['Discount rate (%)', String(economics.discountRatePercent)]);
    assert.deepEqual(rows[2], ['']);
    assert.deepEqual(rows[3], table.columns.map(column => column.csvLabel));
    const data = rows.slice(4);
    assert.equal(data.length, economics.yearlyCashFlows.length + 1, `${name}: one row per year 0..N`);
    data.forEach((cells, index) => {
      table.columns.forEach((column, columnIndex) => {
        assert.equal(Number(cells[columnIndex]), table.rows[index][column.key], `${name} ${column.key} year ${index}`);
      });
    });
  });
});

test('CSV text fields that a spreadsheet would run as formulas are quoted', () => {
  const csv = buildCashFlowCsv({ columns: [], rows: [] }, [['=HYPERLINK("x")', '+1']]);
  assert.equal(csv.split('\r\n')[0], '"=HYPERLINK(""x"")","+1"');
});
