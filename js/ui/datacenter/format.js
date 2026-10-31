/* Number formatting for the datacenter page: energy, power, mass, water and area with sensible units. */

import { FormatNumbers } from '../format-numbers.js';

export const fixed = (value, digits = 0) => FormatNumbers.fixed(value, digits);
export const money = value => FormatNumbers.formatMoney(value);

/** Digits that keep about three significant figures. */
function digitsFor(value) {
  const abs = Math.abs(value);
  if (abs >= 100) return 0;
  if (abs >= 10) return 1;
  return 2;
}

export function formatMW(mw) {
  if (!Number.isFinite(mw)) return '—';
  if (mw === 0) return '0 MW';
  if (Math.abs(mw) >= 1000) return `${fixed(mw / 1000, 2)} GW`;
  if (Math.abs(mw) < 1 && mw !== 0) return `${fixed(mw * 1000, 0)} kW`;
  return `${fixed(mw, digitsFor(mw))} MW`;
}

/** Annual energy from MWh: MWh, GWh or TWh. */
export function formatMWh(mwh) {
  if (!Number.isFinite(mwh)) return '—';
  const abs = Math.abs(mwh);
  if (abs >= 1e6) return `${fixed(mwh / 1e6, 2)} TWh`;
  if (abs >= 1e3) return `${fixed(mwh / 1e3, digitsFor(mwh / 1e3))} GWh`;
  return `${fixed(mwh, digitsFor(mwh))} MWh`;
}

/** Battery energy: MWh or GWh. */
export function formatStorageMWh(mwh) {
  if (!Number.isFinite(mwh)) return '—';
  return Math.abs(mwh) >= 1000 ? `${fixed(mwh / 1000, 2)} GWh` : `${fixed(mwh, digitsFor(mwh))} MWh`;
}

/** Mass from tonnes: t, kt or Mt. */
export function formatTonnes(t) {
  if (!Number.isFinite(t)) return '—';
  const abs = Math.abs(t);
  if (abs >= 1e6) return `${fixed(t / 1e6, 2)} Mt`;
  if (abs >= 1e3) return `${fixed(t / 1e3, digitsFor(t / 1e3))} kt`;
  return `${fixed(t, digitsFor(t))} t`;
}

/** Water volume from m³: m³, thousand m³ or million m³. */
export function formatM3(m3) {
  if (!Number.isFinite(m3)) return '—';
  const abs = Math.abs(m3);
  if (abs >= 1e6) return `${fixed(m3 / 1e6, 2)} million m³`;
  if (abs >= 1e3) return `${fixed(m3 / 1e3, digitsFor(m3 / 1e3))} thousand m³`;
  return `${fixed(m3, 0)} m³`;
}

const M2_PER_ACRE = 4046.8564224;

/** Land area from m²: m² below a hectare, otherwise ha (and km² above 1 km²), with acres. */
export function formatArea(m2) {
  if (!Number.isFinite(m2)) return '—';
  const acres = m2 / M2_PER_ACRE;
  if (m2 >= 1e6) return `${fixed(m2 / 1e6, 2)} km² (${fixed(acres, 0)} acres)`;
  if (m2 >= 1e4) return `${fixed(m2 / 1e4, 1)} ha (${fixed(acres, acres >= 100 ? 0 : 1)} acres)`;
  return `${fixed(m2, 0)} m²`;
}

/** Value of a flow link in its own unit (MWh/yr, m3/yr or t/yr). */
export function formatFlowValue(value, unit) {
  if (unit === 'm3/yr') return `${formatM3(value)}/yr`;
  if (unit === 't/yr') return `${formatTonnes(value)}/yr`;
  return `${formatMWh(value)}/yr`;
}

export const formatPercent = (value, digits = 1) => `${fixed(value, digits)}%`;

/** Uptime with enough decimals to tell 99.98% from 99.99%. */
export function formatUptime(percent) {
  if (!Number.isFinite(percent)) return '—';
  if (percent >= 99.99995) return '100%';
  if (percent >= 99.9) return `${fixed(percent, 3)}%`;
  return `${fixed(percent, 2)}%`;
}

export function formatMonths(months) {
  return `${fixed(months, 0)} month${Math.round(months) === 1 ? '' : 's'}`;
}

/** "2031-07" -> "Jul 2031". */
export function formatYearMonth(date) {
  if (!date) return '—';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[(date.month - 1 + 12) % 12]} ${date.year}`;
}

/** Label for use mid-sentence: "Token price" -> "token price", "GPU rental price" unchanged. */
export const midSentence = label => String(label).replace(/^([A-Z])(?=[a-z])/, char => char.toLowerCase());
