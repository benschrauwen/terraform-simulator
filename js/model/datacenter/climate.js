/* ============================================
   Datacenter climate, PUE and water use
   ============================================
   The modeled year is 365 days x 24 local-standard-time hours. Each hour
   takes its site's typical-day dry- and wet-bulb temperature for that month
   and hour (sites.js 12 x 24 profiles), and the cooling technology's curves
   (cooling.js) turn it into PUE(h) and WUE(h):

     PUE(h) = 1 + overheadFraction + coolingFraction(T_cooling(h))
       coolingFraction = freeCoolingFraction                if T < freeCoolingBelowC
                       = interpolate(mechanicalFractionAt)   otherwise
     WUE(h) = interpolate(water.litresPerKWhITAt, T_water(h))   L per kWh IT

   Both are computed once per month-hour (288 values) and repeated over the
   days of the month. Pure; no DOM. */

import { interpolateCurve } from '../../data/datacenter/cooling.js';

export const HOURS_PER_YEAR = 8760;
export const MONTH_DAYS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

/* Month index (0-11) of every hour of the year. */
export const MONTH_OF_HOUR = (() => {
  const months = new Uint8Array(HOURS_PER_YEAR);
  let hour = 0;
  MONTH_DAYS.forEach((days, month) => {
    months.fill(month, hour, hour + days * 24);
    hour += days * 24;
  });
  return months;
})();

/* First hour of each month. */
export const MONTH_START_HOUR = Object.freeze(MONTH_DAYS.reduce(
  (starts, days, month) => [...starts, starts[month] + days * 24], [0]
).slice(0, 12));

/** Cooling fraction (kW cooling per kW IT) at temperature T. */
export function coolingFractionAt(tech, temperatureC) {
  const { freeCoolingBelowC, freeCoolingFraction, mechanicalFractionAt } = tech.cooling;
  return temperatureC < freeCoolingBelowC ? freeCoolingFraction : interpolateCurve(mechanicalFractionAt, temperatureC);
}

/** PUE at a dry-/wet-bulb pair for one technology. */
export function pueAt(tech, dryBulbC, wetBulbC) {
  const t = tech.cooling.basis === 'wetBulb' ? wetBulbC : dryBulbC;
  return 1 + tech.overheadFraction + coolingFractionAt(tech, t);
}

/** Withdrawn cooling water, litres per kWh of IT energy. */
export function wueAt(tech, dryBulbC, wetBulbC) {
  const t = tech.water.basis === 'wetBulb' ? wetBulbC : dryBulbC;
  return interpolateCurve(tech.water.litresPerKWhITAt, t);
}

/* Expands a 12 x 24 table to the 8760-hour year. */
export function expandMonthHourTable(table) {
  const out = new Float64Array(HOURS_PER_YEAR);
  for (let h = 0; h < HOURS_PER_YEAR; h++) out[h] = table[MONTH_OF_HOUR[h]][h % 24];
  return out;
}

/**
 * Hourly cooling profile of a technology at a site: { pueTable, wueTable
 * (12 x 24), pue, wue, dryBulbC, wetBulbC (8760-h Float64Arrays), peakPue,
 * meanPue (time average = the annual PUE at constant IT load) }.
 */
export function buildCoolingProfile(site, tech) {
  const pueTable = site.dryBulbC.map((row, month) => row.map((dry, hour) => pueAt(tech, dry, site.wetBulbC[month][hour])));
  const wueTable = site.dryBulbC.map((row, month) => row.map((dry, hour) => wueAt(tech, dry, site.wetBulbC[month][hour])));
  const pue = expandMonthHourTable(pueTable);
  let sum = 0;
  let peak = 0;
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    sum += pue[h];
    if (pue[h] > peak) peak = pue[h];
  }
  return {
    pueTable,
    wueTable,
    pue,
    wue: expandMonthHourTable(wueTable),
    dryBulbC: expandMonthHourTable(site.dryBulbC),
    wetBulbC: expandMonthHourTable(site.wetBulbC),
    peakPue: peak,
    meanPue: sum / HOURS_PER_YEAR,
  };
}

/**
 * Typical-day view of an hourly series: { byMonth: 12 x 24 means, average:
 * 24 means over the year }. `scale` converts units (e.g. kW -> MW).
 */
export function typicalDays(series, scale = 1) {
  const sums = Array.from({ length: 12 }, () => new Array(24).fill(0));
  const average = new Array(24).fill(0);
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    sums[MONTH_OF_HOUR[h]][h % 24] += series[h];
    average[h % 24] += series[h];
  }
  return {
    byMonth: sums.map((row, month) => row.map(value => (value * scale) / MONTH_DAYS[month])),
    average: average.map(value => (value * scale) / 365),
  };
}
