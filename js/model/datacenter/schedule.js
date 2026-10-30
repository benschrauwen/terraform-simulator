/* ============================================
   Datacenter project schedule (time to power)
   ============================================
   Every component the design includes is a parallel path from notice-to-
   proceed (month 0). Its duration is permitting + procurement + construction
   for the selected case (low / typical / high), x scheduleScalePercent; the
   phases are additive (power.js: procurement is only the wait that outlasts
   permitting, construction the work left after delivery). A nuclear path
   also cannot finish before January of its type's earliestCodYear.

   Energization = the slowest REQUIRED path; it is the critical path, and
   every path's slack = energization - its duration (negative: an optional
   component that arrives after first power). Required components:
     always            building + fit-out, cooling plant, HV substation
     tokens revenue    GPU / IT delivery (colocation tenants bring their own)
     grid / hybrid     the grid connection (firm or flexible)
     flexible grid     the on-site firm generation and battery that cover the
                       unavailable hours ("bring your own capacity")
     islanded          every on-site source in the design (firm, solar, battery)
   Optional components (e.g. solar or standby gas on a firm grid) do not
   delay first power. Simplification: the dispatch assumes every component
   from energization. Pure; no DOM. */

import { COOLING_TECHNOLOGIES } from '../../data/datacenter/cooling.js';
import { FACILITY_LEAD_TIMES } from '../../data/datacenter/facility.js';
import { DATACENTER_MODEL_ASSUMPTIONS as A } from '../../data/datacenter/model-assumptions.js';
import { GAS_GENSET_TYPES, NUCLEAR_TYPES, POWER_LEAD_TIMES } from '../../data/datacenter/power.js';

const PHASES = ['permittingMonths', 'procurementMonths', 'constructionMonths'];

function addMonths({ year, month }, months) {
  const index = year * 12 + (month - 1) + Math.round(months);
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { year: y, month: m, label: `${y}-${String(m).padStart(2, '0')}` };
}

function monthsUntilYear(ntp, year) {
  return Math.max(0, (year - ntp.year) * 12 - (ntp.month - 1));
}

/** The components the design includes: [{ id, label, leadTimes, required, earliestCodYear? }]. */
export function listScheduleComponents(state, { firm, solarEnabled }) {
  const tech = COOLING_TECHNOLOGIES[state.coolingTechnology];
  const islanded = state.architecture === 'islanded';
  const flexible = !islanded && state.gridConnection === 'flexible';
  const onSiteRequired = islanded || flexible;
  const components = [
    { id: 'shell-fitout', label: FACILITY_LEAD_TIMES['shell-fitout'].label, leadTimes: FACILITY_LEAD_TIMES['shell-fitout'], required: true },
    { id: 'cooling', label: `Cooling plant (${tech.label})`, leadTimes: tech.leadTimes, required: true },
    { id: 'substation', label: POWER_LEAD_TIMES.substation.label, leadTimes: POWER_LEAD_TIMES.substation, required: true },
  ];
  if (state.revenueBasis === 'tokens') {
    components.push({ id: 'it-delivery', label: FACILITY_LEAD_TIMES['it-delivery'].label, leadTimes: FACILITY_LEAD_TIMES['it-delivery'], required: true });
  }
  if (!islanded) {
    const key = flexible ? 'grid-flexible' : 'grid-firm';
    components.push({ id: key, label: POWER_LEAD_TIMES[key].label, leadTimes: POWER_LEAD_TIMES[key], required: true });
  }
  if (firm.family === 'gas') {
    const key = GAS_GENSET_TYPES[state.gasType].leadTimeKey;
    components.push({ id: key, label: POWER_LEAD_TIMES[key].label, leadTimes: POWER_LEAD_TIMES[key], required: onSiteRequired });
  }
  if (firm.family === 'nuclear') {
    const type = NUCLEAR_TYPES[state.nuclearType];
    components.push({
      id: type.leadTimeKey, label: POWER_LEAD_TIMES[type.leadTimeKey].label, leadTimes: POWER_LEAD_TIMES[type.leadTimeKey],
      required: onSiteRequired, earliestCodYear: type.earliestCodYear,
    });
  }
  if (solarEnabled) components.push({ id: 'solar', label: POWER_LEAD_TIMES.solar.label, leadTimes: POWER_LEAD_TIMES.solar, required: islanded });
  if (state.batteryCapacityMWh > 0) components.push({ id: 'battery', label: POWER_LEAD_TIMES.battery.label, leadTimes: POWER_LEAD_TIMES.battery, required: onSiteRequired });
  return components;
}

/**
 * Schedule: { case, scale, noticeToProceed, paths: [{ id, label, required,
 * phases: { permittingMonths, procurementMonths, constructionMonths },
 * waitForCodMonths, durationMonths, slackMonths, critical, finish }],
 * energizationMonth, energizationDate, energizationYears, criticalPath:
 * { id, label, durationMonths } }.
 */
export function buildSchedule(state, context) {
  const scheduleCase = state.scheduleCase;
  const scale = state.scheduleScalePercent / 100;
  const ntp = A.projectNoticeToProceed;
  const paths = listScheduleComponents(state, context).map(component => {
    const phases = Object.fromEntries(PHASES.map(phase => [phase, (component.leadTimes[phase]?.[scheduleCase] || 0) * scale]));
    const leadMonths = PHASES.reduce((sum, phase) => sum + phases[phase], 0);
    const codFloor = Number.isFinite(component.earliestCodYear) ? monthsUntilYear(ntp, component.earliestCodYear) : 0;
    const durationMonths = Math.max(leadMonths, codFloor);
    return {
      id: component.id,
      label: component.label,
      required: component.required,
      phases,
      waitForCodMonths: durationMonths - leadMonths,
      durationMonths,
      finish: addMonths(ntp, durationMonths),
    };
  });
  const required = paths.filter(path => path.required);
  const critical = required.reduce((best, path) => (!best || path.durationMonths > best.durationMonths ? path : best), null);
  const energizationMonth = critical ? critical.durationMonths : 0;
  paths.forEach(path => {
    path.slackMonths = energizationMonth - path.durationMonths;
    path.critical = path === critical;
  });
  return {
    case: scheduleCase,
    scale,
    noticeToProceed: addMonths(ntp, 0),
    paths,
    energizationMonth,
    energizationYears: energizationMonth / 12,
    energizationDate: addMonths(ntp, energizationMonth),
    criticalPath: critical ? { id: critical.id, label: critical.label, durationMonths: critical.durationMonths } : null,
  };
}
