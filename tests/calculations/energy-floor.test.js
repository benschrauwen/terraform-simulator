/*
 * Every exploratory route must supply at least the reaction enthalpy of its
 * product from electricity plus the H2 it consumes (at the H2 HHV, 39.4
 * kWh/kg, the enthalpy of splitting liquid water). Floors are standard
 * enthalpies of reaction at 25 C from formation enthalpies (kJ/mol):
 *   CO2 -393.5, CO -110.5, H2O(l) -285.8, CaCO3 -1207.6, CaO -634.9,
 *   NH3 -45.9, Fe2O3 -824.2, SiO2 -910.9, Al2O3 -1675.7, TiO2 -944.0.
 * MWh/t = kJ/mol / (g/mol) / 3.6.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ModuleCatalog } from './harness.js';

const H2_HHV_KWH_PER_KG = 39.4;
const floorMWhPerTonne = (kjPerMol, gramsPerMol) => kjPerMol / gramsPerMol / 3.6;

// Route -> minimum energy per output unit (kWh), or null with the reason the
// route's energy is partly supplied by an external chemical feed.
const FLOORS = {
  'specialtyCarbon/molten-carbonate': floorMWhPerTonne(393.5, 12.011) * 1000, // CO2 -> C + O2: 9.1 MWh/t
  'specialtyCarbon/graphene-grade': floorMWhPerTonne(393.5, 12.011) * 1000,
  'lime/resistive-calciner': floorMWhPerTonne(1207.6 - 634.9 - 393.5, 56.077) * 1000, // CaCO3 -> CaO + CO2: 0.88 MWh/t
  'lime/indirect-heated': floorMWhPerTonne(1207.6 - 634.9 - 393.5, 56.077) * 1000,
  // ~1.2 t CaCO3 per t clinker calcined: 1.2 x 178.9 kJ/mol / 100.09 g/mol.
  'cement/electrified-precalciner': 1.2 * floorMWhPerTonne(179.2, 100.087) * 1000,
  'cement/integrated-electric-kiln': 1.2 * floorMWhPerTonne(179.2, 100.087) * 1000,
  'carbonMonoxide/plasma': floorMWhPerTonne(393.5 - 110.5, 28.01) * 1000, // CO2 -> CO + 1/2 O2: 2.8 MWh/t
  'carbonMonoxide/rwgs': floorMWhPerTonne(393.5 - 110.5, 28.01) * 1000,
  'carbonMonoxide/low-temp-electrolysis': floorMWhPerTonne(393.5 - 110.5, 28.01) * 1000,
  'carbonMonoxide/soec-coelectrolysis': floorMWhPerTonne(393.5 - 110.5, 28.01) * 1000,
  // N2 + 3 H2O(l) -> 2 NH3 + 3/2 O2: (3 x 285.8 - 2 x 45.9) / 2 = 382.8 kJ/mol NH3 = 6.2 MWh/t
  'ammonia/haber-bosch': floorMWhPerTonne(382.8, 17.031) * 1000,
  'ammonia/electrochemical': floorMWhPerTonne(382.8, 17.031) * 1000,
  // Fe2O3 -> 2 Fe + 3/2 O2: 824.2 kJ per 2 mol Fe = 2.05 MWh/t
  'steel/h2-dri-eaf': floorMWhPerTonne(824.2 / 2, 55.845) * 1000,
  'steel/molten-oxide-electrolysis': floorMWhPerTonne(824.2 / 2, 55.845) * 1000,
  'steel/flash-ironmaking': null, // external gaseous reductant supplies the reduction energy
  'silicon/electric-furnace': null, // carbon reductant (SiO2 + 2C -> Si + 2CO)
  'silicon/electrochemical-reduction': floorMWhPerTonne(910.9, 28.086) * 1000, // 9.0 MWh/t
  'aluminum/hall-heroult': null, // consumable carbon anodes supply part of the energy
  'aluminum/novel-electrolysis': floorMWhPerTonne(1675.7 / 2, 26.982) * 1000, // inert anode: 8.6 MWh/t
  'titanium/kroll-like': null, // Mg reductant and TiCl4 made outside the boundary
  'titanium/ffc-cambridge': floorMWhPerTonne(944.0, 47.867) * 1000, // 5.5 MWh/t
  'mtg/fixed-bed': 0, // methanol -> hydrocarbons is exothermic
  'mtg/fluid-bed': 0,
  // Seawater at ~35 g/L: minimum separation work ~0.7-1.1 kWh/m3; brackish < 0.3.
  'desalination/reverse-osmosis': 0.7,
  'desalination/thermal': 0.7,
  'desalination/electrodialysis': 0.1,
};

test('every exploratory route supplies at least its reaction enthalpy', () => {
  const routes = ModuleCatalog.getAll()
    .filter(module => module.exploratory)
    .flatMap(module => Object.entries(module.routes).map(([route, config]) => [`${module.id}/${route}`, config]));
  assert.ok(routes.length > 20);
  routes.forEach(([key, config]) => {
    assert.ok(Object.hasOwn(FLOORS, key), `missing energy floor for ${key}`);
    const floor = FLOORS[key];
    if (floor === null) return;
    const supplied = config.electricityKwhPerUnit + ((config.feedstocks?.h2Kg || 0) * H2_HHV_KWH_PER_KG);
    assert.ok(supplied >= floor, `${key}: ${supplied.toFixed(0)} kWh/unit < enthalpy floor ${floor.toFixed(0)}`);
  });
});

test('reaction floors match the hand-derived values quoted in the audit', () => {
  const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
  close(FLOORS['specialtyCarbon/molten-carbonate'], 9100, 50);
  close(FLOORS['lime/resistive-calciner'], 880, 10);
  close(FLOORS['carbonMonoxide/plasma'], 2810, 10);
});
