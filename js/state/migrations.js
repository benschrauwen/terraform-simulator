/* ============================================
   Legacy state migrations
   ============================================
   Rewrites state saved by older versions (share links, localStorage) into the
   current schema before normalization. Each alias maps a retired policyMode to
   its replacement scheme plus the input value the old mode implied. */

import { toFiniteNumber } from '../util.js';

const LEGACY_POLICY_MODE_ALIASES = {
  us_45v_tier4: state => ({
    policyMode: 'us_45v_h2',
    us45vHydrogenCreditPerKg: toFiniteNumber(state.us45vHydrogenCreditPerKg, 3.00),
  }),
  us_45v_tier3: state => ({
    policyMode: 'us_45v_h2',
    us45vHydrogenCreditPerKg: toFiniteNumber(state.us45vHydrogenCreditPerKg, 1.00),
  }),
  us_45v_tier2: state => ({
    policyMode: 'us_45v_h2',
    us45vHydrogenCreditPerKg: toFiniteNumber(state.us45vHydrogenCreditPerKg, 0.75),
  }),
  us_45v_tier1: state => ({
    policyMode: 'us_45v_h2',
    us45vHydrogenCreditPerKg: toFiniteNumber(state.us45vHydrogenCreditPerKg, 0.60),
  }),
  us_45q_utilization: state => ({
    policyMode: 'us_45q_dac',
    us45qDacCreditPerTon: toFiniteNumber(state.us45qDacCreditPerTon, 130),
  }),
  us_45q_sequestration: state => ({
    policyMode: 'us_45q_dac',
    us45qDacCreditPerTon: toFiniteNumber(state.us45qDacCreditPerTon, 180),
  }),
  eu_hydrogen_bank: state => ({
    policyMode: 'eu_ehb_rfnbo',
    euHydrogenBankPremiumPerKg: toFiniteNumber(
      state.euHydrogenBankPremiumPerKg,
      toFiniteNumber(state.customH2Credit, 0)
    ),
  }),
};

/* Returns a shallow copy of `rawState` with legacy fields rewritten. */
export function migrateLegacyState(rawState = {}) {
  const input = rawState && typeof rawState === 'object' ? rawState : {};
  const migrated = { ...input };
  const mode = migrated.policyMode;

  if (typeof mode === 'string' && Object.hasOwn(LEGACY_POLICY_MODE_ALIASES, mode)) {
    Object.assign(migrated, LEGACY_POLICY_MODE_ALIASES[mode](migrated));
  }

  return migrated;
}
