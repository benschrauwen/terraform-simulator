/* The Firm generation sizing block (js/ui/datacenter/firm-info.js) and the plant layout follow the
   uptime-driven sizing: required MW and units from result.firm.sizingBasis, the share of CAPEX the
   backup represents, the "no firm generation needed" case, and the diesel naming. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateDatacenterScenario, DATACENTER_DEFAULT_STATE } from '../../js/model/datacenter/index.js';
import { getDatacenterControlSpecs } from '../../js/ui/datacenter/control-spec.js';
import { FIRM_BLOCK_RENDERERS } from '../../js/ui/datacenter/firm-info.js';
import { plantBlockItems } from '../../js/ui/datacenter/plant-layout.js';

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const sizingText = state => {
  const r = calculateDatacenterScenario(state);
  return { r, out: text(FIRM_BLOCK_RENDERERS.firmSizing(r.state, r)) };
};

test('the sizing block shows the MW and units the uptime target needs and the CAPEX share', () => {
  const { r, out } = sizingText(DATACENTER_DEFAULT_STATE);
  const basis = r.firm.sizingBasis;
  assert.match(out, new RegExp(`Needed for the uptime target ${basis.requiredMW.toFixed(1).replace('.', '\\.')} MW → ${basis.minUnits} units`));
  assert.match(out, new RegExp(`Installed ${r.firm.units} × 3\\.00 MW`));
  assert.match(out, new RegExp(`N\\+1 \\(N = ${basis.minUnits} for the uptime target\\)`));
  // Share of CAPEX = generator capex / total capex.
  const gas = r.economics.capexItems.find(item => item.key === 'gas');
  const share = (gas.capex / r.economics.totalCapex) * 100;
  assert.match(out, new RegExp(`Share of CAPEX ${share.toFixed(1).replace('.', '\\.')}%`));
  assert.match(out, /EPA run hours 3 h emergency \+ 0 h other/);
});

test('when battery and grid cover the target, the block says no firm generation is needed', () => {
  const { r, out } = sizingText({ ...DATACENTER_DEFAULT_STATE, batteryCapacityMWh: 400 });
  assert.equal(r.firm.units, 0);
  assert.match(out, /No firm generation needed for the uptime target \(spares only if you add units manually\)/);
  assert.doesNotMatch(out, /set at least one unit/);
});

test('battery and uptime target move the units, and the plant layout block follows', () => {
  const gasBlock = state => plantBlockItems(calculateDatacenterScenario(state)).find(block => block.key === 'gasPlant');
  const base = gasBlock(DATACENTER_DEFAULT_STATE);
  const withBattery = gasBlock({ ...DATACENTER_DEFAULT_STATE, batteryCapacityMWh: 200 });
  assert.equal(base.name, 'Diesel generators');
  assert.ok(withBattery.areaM2 < base.areaM2);
  assert.notEqual(withBattery.detail, base.detail);
  // A target loose enough for the 3 outage hours removes the block altogether.
  assert.equal(gasBlock({ ...DATACENTER_DEFAULT_STATE, uptimeTargetPercent: 99.9 }), undefined);
});

test('the auto sizing option is labelled by the uptime rule and switching to manual keeps the count', () => {
  const spec = getDatacenterControlSpecs().find(entry => entry.id === 'firmSizingMode');
  assert.equal(spec.options({ firmFamily: 'gas' })[0].label, 'Auto (meet uptime target + spare units)');
  const app = { state: { ...DATACENTER_DEFAULT_STATE, firmSizingMode: 'manual' }, lastResults: { firm: { units: 32 } }, syncStateToControls() {} };
  spec.onChange(app, 'manual', 'auto');
  assert.equal(app.state.firmUnits, 32);
});
