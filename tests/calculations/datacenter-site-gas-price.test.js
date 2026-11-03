/* Natural gas follows the site's market: Henry Hub plus delivery at US sites, the TTF forward for
   the plant's operating years plus delivery at European sites (power.js EUROPE_GAS). Diesel keeps
   its own price everywhere; a site change resets the price like the other site-driven fields. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { EUROPE_GAS, GAS_DEFAULTS, ttfPerMMBtu } from '../../js/data/datacenter/power.js';
import { USD_PER_EUR } from '../../js/data/datacenter/carbon.js';
import { DATACENTER_SITES } from '../../js/data/datacenter/sites.js';
import { calculateDatacenterScenario, DATACENTER_DEFAULT_STATE, optimizeForSite } from '../../js/model/datacenter/index.js';
import { applyArchitectureDefaults, applyDatacenterPresetDefaults } from '../../js/state/datacenter-schema.js';

const atSite = (siteId, state = DATACENTER_DEFAULT_STATE) => applyDatacenterPresetDefaults({ ...state, siteId }, 'siteId');

test('the European default is the Cal-30 to Cal-32 TTF average plus delivery', () => {
  const { cal30, cal31, cal32 } = EUROPE_GAS.ttfForwardEurPerMWh;
  assert.equal(EUROPE_GAS.usdPerEur, USD_PER_EUR);
  const hub = ttfPerMMBtu((cal30 + cal31 + cal32) / 3);
  assert.ok(Math.abs(hub - 8.59) < 0.01);
  assert.ok(Math.abs(hub + EUROPE_GAS.deliveredAdderPerMMBtu - EUROPE_GAS.fuelPricePerMMBtu) < 0.25);
  // October 2026 spot, ~$28/MMBtu, is not what the default uses.
  assert.ok(Math.abs(ttfPerMMBtu(EUROPE_GAS.ttfOctober2026EurPerMWh) - 28.2) < 0.1);
});

test('every site gets its market price; diesel is unchanged', () => {
  DATACENTER_SITES.forEach(site => {
    const gas = applyArchitectureDefaults(atSite(site.id), 'islanded');
    assert.equal(gas.gasFuelPricePerMMBtu, site.country === 'US' ? GAS_DEFAULTS.fuelPricePerMMBtu : EUROPE_GAS.fuelPricePerMMBtu, site.id);
    assert.equal(applyArchitectureDefaults(atSite(site.id), 'grid').gasFuelPricePerMMBtu, 33, site.id);
  });
});

test('a site change resets the gas price, in both directions, and the type selection follows the site', () => {
  const dublin = applyArchitectureDefaults(atSite('dublin-ie'), 'hybrid');
  assert.equal(dublin.gasFuelPricePerMMBtu, 9);
  assert.equal(atSite('abilene-tx', { ...dublin, gasFuelPricePerMMBtu: 20 }).gasFuelPricePerMMBtu, 4);
  assert.equal(atSite('dublin-ie', { ...atSite('abilene-tx', dublin), gasFuelPricePerMMBtu: 20 }).gasFuelPricePerMMBtu, 9);
  assert.equal(applyDatacenterPresetDefaults({ ...dublin, gasType: 'aero' }, 'gasType').gasFuelPricePerMMBtu, 9);
});

test('the price reaches the fuel bill, the gas-versus-grid choice and the site survey', () => {
  const state = applyArchitectureDefaults(atSite('dublin-ie'), 'islanded');
  const result = calculateDatacenterScenario(state);
  const line = key => result.economics.opexLines.find(item => item.key === key).annual;
  assert.ok(Math.abs(line('gasFuel') - result.dispatch.annual.fuelMMBtu * 9) < 1);
  // Carbon stays on top of the fuel: 0.05291 t/MMBtu x $96.30/t.
  assert.ok(Math.abs(line('carbonPrice') - result.dispatch.annual.fuelMMBtu * 0.05291 * 96.3) < 1);
  const survey = optimizeForSite(DATACENTER_DEFAULT_STATE, 'dublin-ie', { budget: 150 });
  if (survey.state.firmFamily === 'gas' && survey.state.gasType !== 'standby-diesel') assert.equal(survey.state.gasFuelPricePerMMBtu, 9);
});
