/* ============================================
   Datacenter scenario warnings
   ============================================
   Plain-language flags on a computed scenario: unmet uptime, supply gaps,
   double-counted grid charges, schedule beyond the horizon. Each is
   { key, message }. Pure; no DOM. */

const fmt = (value, digits = 0) => Number(value).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function buildWarnings(result, { designPeakKW }) {
  const { state, site, reliability, firm, grid, solar, schedule, economics, dispatch } = result;
  const warnings = [];
  const add = (key, message) => warnings.push({ key, message });

  if (!reliability.meetsTarget) {
    add('uptime-below-target', `Supply covers the full load in ${fmt(reliability.uptimePercent, 3)}% of hours, below the ${fmt(state.uptimeTargetPercent, 3)}% target: ${fmt(reliability.unservedHours)} h and ${fmt(reliability.unservedMWh)} MWh a year go unserved.`);
  }
  if (state.architecture === 'islanded' && firm.family === 'none' && !solar.enabled) {
    add('islanded-no-supply', 'An islanded site needs on-site supply: add gas or nuclear generation, or solar with a battery.');
  }
  if (state.architecture === 'islanded' && firm.family === 'nuclear' && !firm.onSite) {
    add('islanded-contracted-nuclear', 'An existing-plant contract is delivered over the grid unless the datacenter sits next to the plant; islanded here means a co-located, behind-the-meter supply.');
  }
  if (grid.connected && state.gridConnection === 'flexible' && firm.family === 'none' && !(state.batteryCapacityMWh > 0)) {
    add('flexible-no-backup', `A flexible connection is unavailable ${fmt(grid.unavailableHours)} h a year; without on-site generation or a battery the load goes unserved in those hours.`);
  }
  if (firm.family === 'gas' && firm.capacityMW * 1000 < designPeakKW - 1e-6 && (state.architecture === 'islanded' || state.gridConnection === 'flexible')) {
    add('gas-below-peak', `Gas capacity (${fmt(firm.capacityMW, 1)} MW) is below the design facility peak (${fmt(designPeakKW / 1000, 1)} MW).`);
  }
  if (state.architecture === 'islanded' && dispatch.batteryRole === 'reserve' && firm.family !== 'gas') {
    add('battery-idle', 'With no solar, nuclear or gas on an islanded site, nothing can charge the battery.');
  }
  if (state.gridDemandChargePerKWMonth > 0 && Math.abs(state.gridEnergyPricePerMWh - site.electricityPriceAltUsdPerMWh) < 1e-6 && grid.connected) {
    add('demand-charge-double-count', `The grid energy price is the site's all-in EIA average (${site.electricityPriceAltBasis}), which already includes demand charges; a separate demand charge counts them twice.`);
  }
  if (!solar.reachable) {
    add('solar-yield-capped', 'The requested solar yield exceeds what the array can deliver at nameplate during modeled daylight; output is capped.');
  }
  if (schedule.energizationYears >= state.analysisHorizonYears) {
    add('energization-after-horizon', `First power (${schedule.energizationDate.label}) falls at or after the end of the ${state.analysisHorizonYears}-year analysis horizon, so the project earns nothing.`);
  }
  const lateOptional = schedule.paths.filter(path => !path.required && path.slackMonths < 0);
  if (lateOptional.length) {
    add('optional-after-energization', `${lateOptional.map(path => path.label).join(', ')} ${lateOptional.length > 1 ? 'arrive' : 'arrives'} after first power; the model runs them from energization anyway.`);
  }
  if (firm.family === 'nuclear' && dispatch.annual.curtailedMWh > 0.01 * dispatch.annual.nuclearMWh) {
    add('nuclear-surplus', firm.onSite
      ? `The reactor backs down by ${fmt(dispatch.annual.curtailedMWh)} MWh a year it cannot deliver; its capacity is paid for but idle. Export it or size the reactor closer to the load.`
      : `${fmt(dispatch.annual.curtailedMWh)} MWh a year of contracted output cannot be used but is paid for (take-or-pay); export it or contract closer to the load.`);
  }
  if (!(economics.totalAnnualRevenue > 0)) {
    add('no-revenue', 'The design earns no revenue.');
  }
  return warnings;
}
