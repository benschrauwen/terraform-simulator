/* Incentive scheme registry and policy cash-flow helpers */

const POLICY_SELECT_GROUPS = [
  {
    label: 'Baseline',
    ids: ['none'],
  },
  {
    label: 'United States',
    ids: [
      'us_48e_solar',
      'us_45y_solar',
      'us_45v_h2',
      'us_45q_dac',
      'us_h2_hubs',
      'us_dac_hubs',
    ],
  },
  {
    label: 'Europe',
    ids: [
      'eu_ehb_rfnbo',
      'eu_innovation_fund',
      'de_eeg_solar',
      'de_h2_aaas',
      'nl_sdepp',
      'nl_owe_h2_capex',
      'nl_owe_h2_opex',
      'uk_cfd_solar_ar7',
      'uk_hpbm_h2',
      'uk_ggr_dac',
      'es_h2_aaas',
    ],
  },
  {
    label: 'Framework-Only',
    ids: [
      'eu_rediii',
      'eu_cisaf',
      'eu_crcf',
      'eu_rfnbo_rules',
      'eu_ets_if',
      'us_transfer_directpay',
    ],
  },
  {
    label: 'Custom',
    ids: ['custom'],
  },
];

const POLICY_SCHEMES = {
  none: {
    label: 'No direct support',
    selectLabel: 'No direct support',
    jurisdiction: 'None selected',
    policyLayer: 'N/A',
    technology: 'Cross-technology',
    simulatorTreatment: 'none',
    supportFamily: 'none',
    supportTiming: 'N/A',
    durationYears: null,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'No direct support selected',
    implementationFormula: 'No direct support cash flow is modeled.',
    basis: 'Pure market revenue only',
    note: 'Select one named policy regime or use Custom mixed support for a user-defined stack.',
    cashflowType: 'none',
  },

  us_48e_solar: {
    label: 'US 48E solar ITC',
    selectLabel: 'US 48E solar ITC',
    jurisdiction: 'United States',
    policyLayer: 'Federal',
    technology: 'Solar electricity',
    simulatorTreatment: 'deterministic_formula',
    supportFamily: 'investment_tax_credit',
    supportTiming: 'Close / placed in service',
    durationYears: 0,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'Domestic content and energy community adders can apply.',
    stackingOrExclusivity: 'Cannot claim both 48E and 45Y on the same facility.',
    implementationFormula: 'support_t0 = eligible_solar_capex * chosen_rate',
    basis: 'One-time solar CAPEX support on the installed PV block',
    note: 'Modeled as an upfront reduction to solar installation CAPEX. Use the selected rate to reflect prevailing-wage, domestic-content, and energy-community assumptions.',
    cashflowType: 'capex_share',
    eligibleCapexBasis: 'solar',
    inputs: [
      {
        key: 'us48eSolarRate',
        label: '48E rate (share of solar CAPEX)',
        min: 0.06,
        max: 0.50,
        step: 0.01,
        defaultValue: 0.30,
        format: 'share',
      },
    ],
  },

  us_45y_solar: {
    label: 'US 45Y solar PTC',
    selectLabel: 'US 45Y solar PTC',
    jurisdiction: 'United States',
    policyLayer: 'Federal',
    technology: 'Solar electricity',
    simulatorTreatment: 'deterministic_formula',
    supportFamily: 'production_tax_credit',
    supportTiming: 'Annual operating cash flow',
    durationYears: 10,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'Domestic content and energy community adders can apply.',
    stackingOrExclusivity: 'Cannot claim both 45Y and 48E on the same facility.',
    implementationFormula: 'support_t = eligible_kWh_t * credit_rate_t',
    basis: 'Annual solar-output support on eligible PV generation',
    note: 'Modeled on annual solar generation. The selected rate should reflect the applicable wage and bonus assumptions for the power-side credit.',
    cashflowType: 'unit_support',
    outputBasis: 'solar_kwh',
    inputs: [
      {
        key: 'us45ySolarCreditPerKwh',
        label: '45Y credit ($/kWh)',
        min: 0.003,
        max: 0.00363,
        step: 0.00001,
        defaultValue: 0.00363,
        format: 'currency_per_kwh',
      },
    ],
  },

  us_45v_h2: {
    label: 'US 45V hydrogen PTC',
    selectLabel: 'US 45V hydrogen PTC',
    jurisdiction: 'United States',
    policyLayer: 'Federal',
    technology: 'Renewable / clean hydrogen',
    simulatorTreatment: 'deterministic_formula',
    supportFamily: 'production_tax_credit',
    supportTiming: 'Annual operating cash flow',
    durationYears: 10,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 1,
    renewableAttributeGate: 1,
    domesticContentOrLocationBonus: 'No direct domestic-content adder in the per-kg value.',
    stackingOrExclusivity: '45V should not be stacked with 45Q on the same qualifying facility.',
    implementationFormula: 'support_t = verified_H2_kg_t * credit_per_kg_tier_t',
    basis: 'Annual H2-output support on qualifying clean hydrogen production',
    note: 'The selected per-kg amount should reflect the lifecycle-emissions tier and any prevailing-wage multiplier assumption.',
    cashflowType: 'unit_support',
    outputBasis: 'hydrogen_kg',
    inputs: [
      {
        key: 'us45vHydrogenCreditPerKg',
        label: '45V credit ($/kg H2)',
        min: 0.12,
        max: 3.00,
        step: 0.01,
        defaultValue: 3.00,
        format: 'currency_per_kg',
      },
    ],
  },

  us_45q_dac: {
    label: 'US 45Q DAC credit',
    selectLabel: 'US 45Q DAC credit',
    jurisdiction: 'United States',
    policyLayer: 'Federal',
    technology: 'Direct air capture / CO2 removal',
    simulatorTreatment: 'deterministic_formula',
    supportFamily: 'production_tax_credit',
    supportTiming: 'Annual operating cash flow',
    durationYears: 12,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No direct domestic-content bonus in the per-ton value.',
    stackingOrExclusivity: 'Verify the storage or utilization route and avoid stacking with 45V on the same qualifying facility.',
    implementationFormula: 'support_t = qualified_tCO2_t * credit_per_tCO2',
    basis: 'Annual DAC-output support on qualifying captured CO2',
    note: 'Modeled on annual DAC capture. Use the selected rate to reflect the storage or utilization structure and wage assumption.',
    cashflowType: 'unit_support',
    outputBasis: 'co2_ton',
    inputs: [
      {
        key: 'us45qDacCreditPerTon',
        label: '45Q credit ($/tCO2)',
        min: 36,
        max: 180,
        step: 1,
        defaultValue: 180,
        format: 'currency_per_ton',
      },
    ],
  },

  us_h2_hubs: {
    label: 'US Hydrogen Hubs grant',
    selectLabel: 'US Hydrogen Hubs grant',
    jurisdiction: 'United States',
    policyLayer: 'Federal',
    technology: 'Renewable / clean hydrogen',
    simulatorTreatment: 'case_specific_grant',
    supportFamily: 'competitive_capex_grant',
    supportTiming: 'Close / milestone-based',
    durationYears: 0,
    competitiveFlag: 1,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Can be stacked with tax credits subject to award terms.',
    implementationFormula: 'support_t0 = eligible_electrolyzer_capex * user_assumed_grant_share',
    basis: 'Case-specific upfront grant on the electrolyzer block',
    note: 'The real program is negotiated and project-specific. In this app it is treated as a discretionary upfront grant share on electrolyzer CAPEX.',
    cashflowType: 'capex_share',
    eligibleCapexBasis: 'electrolyzer',
    inputs: [
      {
        key: 'usH2HubsGrantShare',
        label: 'Hydrogen Hubs grant share',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0,
        format: 'share',
      },
    ],
  },

  us_dac_hubs: {
    label: 'US DAC Hubs grant',
    selectLabel: 'US DAC Hubs grant',
    jurisdiction: 'United States',
    policyLayer: 'Federal',
    technology: 'Direct air capture / CO2 removal',
    simulatorTreatment: 'case_specific_grant',
    supportFamily: 'competitive_capex_grant',
    supportTiming: 'Close / milestone-based',
    durationYears: 0,
    competitiveFlag: 1,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Can be stacked with 45Q subject to award terms.',
    implementationFormula: 'support_t0 = eligible_dac_capex * user_assumed_grant_share',
    basis: 'Case-specific upfront grant on the DAC block',
    note: 'The real program is negotiated and project-specific. In this app it is treated as a discretionary upfront grant share on DAC CAPEX.',
    cashflowType: 'capex_share',
    eligibleCapexBasis: 'dac',
    inputs: [
      {
        key: 'usDacHubsGrantShare',
        label: 'DAC Hubs grant share',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0,
        format: 'share',
      },
    ],
  },

  eu_ehb_rfnbo: {
    label: 'EU Hydrogen Bank premium',
    selectLabel: 'EU Hydrogen Bank premium',
    jurisdiction: 'European Union / EEA',
    policyLayer: 'EU-wide',
    technology: 'Renewable hydrogen',
    simulatorTreatment: 'auction_user_input',
    supportFamily: 'fixed_premium_per_kg',
    supportTiming: 'Annual operating cash flow',
    durationYears: 10,
    competitiveFlag: 1,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 1,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Can stack with member-state top-ups only where scheme rules allow.',
    implementationFormula: 'support_t = verified_RFNBO_H2_kg_t * auction_premium_per_kg',
    basis: 'Bid-based H2 premium on qualifying RFNBO output',
    note: 'Enter the assumed winning premium. This is not one statutory EU-wide amount and may include national top-ups routed through the auction.',
    cashflowType: 'unit_support',
    outputBasis: 'hydrogen_kg',
    inputs: [
      {
        key: 'euHydrogenBankPremiumPerKg',
        label: 'Hydrogen Bank premium ($/kg equivalent)',
        min: 0,
        max: 10,
        step: 0.05,
        defaultValue: 0,
        format: 'currency_per_kg',
      },
    ],
  },

  eu_innovation_fund: {
    label: 'EU Innovation Fund grant',
    selectLabel: 'EU Innovation Fund grant',
    jurisdiction: 'European Union',
    policyLayer: 'EU-wide',
    technology: 'Cross-technology',
    simulatorTreatment: 'case_specific_grant',
    supportFamily: 'competitive_capex_grant',
    supportTiming: 'Close / milestone-based',
    durationYears: 0,
    competitiveFlag: 1,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Stacking is subject to grant terms and state-aid limits.',
    implementationFormula: 'support_t0 = eligible_project_capex * user_assumed_grant_share',
    basis: 'Case-specific upfront grant on total project CAPEX',
    note: 'Treat this as a discretionary capital grant. The app applies the selected share across total installed CAPEX.',
    cashflowType: 'capex_share',
    eligibleCapexBasis: 'total',
    inputs: [
      {
        key: 'euInnovationFundGrantShare',
        label: 'Innovation Fund grant share',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0,
        format: 'share',
      },
    ],
  },

  de_eeg_solar: {
    label: 'Germany EEG solar premium',
    selectLabel: 'Germany EEG solar premium',
    jurisdiction: 'Germany',
    policyLayer: 'National',
    technology: 'Solar electricity',
    simulatorTreatment: 'auction_user_input',
    supportFamily: 'market_premium',
    supportTiming: 'Annual operating cash flow',
    durationYears: null,
    competitiveFlag: 1,
    referencePriceRequired: 1,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Project-specific auction terms apply.',
    implementationFormula: 'support_t = eligible_kWh_t * max(award_or_market_premium_t, 0)',
    basis: 'Indicative solar market premium on eligible PV output',
    note: 'The default premium reflects the 8.0 ct/kWh indicative monitoring value cited in the policy sheet, not a guaranteed tariff for new awards.',
    cashflowType: 'unit_support',
    outputBasis: 'solar_kwh',
    inputs: [
      {
        key: 'deEegSolarPremiumPerKwh',
        label: 'EEG net premium ($/kWh equivalent)',
        min: 0,
        max: 0.20,
        step: 0.005,
        defaultValue: 0.08,
        format: 'currency_per_kwh',
      },
    ],
  },

  de_h2_aaas: {
    label: 'Germany H2 Auctions-as-a-Service',
    selectLabel: 'Germany H2 Auctions-as-a-Service',
    jurisdiction: 'Germany',
    policyLayer: 'National',
    technology: 'Renewable hydrogen',
    simulatorTreatment: 'auction_user_input',
    supportFamily: 'direct_grant_per_kg',
    supportTiming: 'Annual operating cash flow',
    durationYears: 10,
    competitiveFlag: 1,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 1,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Stacking is subject to scheme and state-aid rules.',
    implementationFormula: 'support_t = verified_RFNBO_H2_kg_t * auction_grant_per_kg',
    basis: 'Bid-based H2 premium on qualifying RFNBO output',
    note: 'Enter the assumed awarded per-kg grant. The actual German program is auction-cleared and RFNBO-gated.',
    cashflowType: 'unit_support',
    outputBasis: 'hydrogen_kg',
    inputs: [
      {
        key: 'deHydrogenAaasPremiumPerKg',
        label: 'German H2 premium ($/kg equivalent)',
        min: 0,
        max: 10,
        step: 0.05,
        defaultValue: 0,
        format: 'currency_per_kg',
      },
    ],
  },

  nl_sdepp: {
    label: 'Netherlands SDE++',
    selectLabel: 'Netherlands SDE++',
    jurisdiction: 'Netherlands',
    policyLayer: 'National',
    technology: 'Solar electricity / low-carbon production',
    simulatorTreatment: 'auction_user_input',
    supportFamily: 'operating_subsidy_correction_mechanism',
    supportTiming: 'Annual operating cash flow',
    durationYears: null,
    competitiveFlag: 1,
    referencePriceRequired: 1,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'May not stack with overlapping Dutch schemes.',
    implementationFormula: 'support_t = eligible_MWh_t * max(base_amount_t - correction_amount_t, 0)',
    basis: 'Net solar-output support equal to base amount minus correction amount',
    note: 'This remains a simplified solar-output proxy. Enter the awarded base amount and the expected correction amount in model-currency-per-MWh terms.',
    cashflowType: 'base_minus_correction',
    outputBasis: 'solar_mwh',
    inputs: [
      {
        key: 'nlSdeppBaseAmountPerMwh',
        label: 'SDE++ base amount ($/MWh equivalent)',
        min: 0,
        max: 250,
        step: 1,
        defaultValue: 0,
        format: 'currency_per_mwh',
      },
      {
        key: 'nlSdeppCorrectionAmountPerMwh',
        label: 'SDE++ correction amount ($/MWh equivalent)',
        min: 0,
        max: 250,
        step: 1,
        defaultValue: 0,
        format: 'currency_per_mwh',
      },
    ],
  },

  nl_owe_h2_capex: {
    label: 'Netherlands OWE H2 capex',
    selectLabel: 'Netherlands OWE H2 capex',
    jurisdiction: 'Netherlands',
    policyLayer: 'National',
    technology: 'Renewable hydrogen',
    simulatorTreatment: 'deterministic_formula',
    supportFamily: 'capex_grant',
    supportTiming: 'Close / COD',
    durationYears: 0,
    competitiveFlag: 1,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 1,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Cannot receive OWE 2024 if the same electrolyzer already received SDE++ or OWE 2023 support.',
    implementationFormula: 'support_t0 = eligible_electrolyzer_capex * chosen_grant_rate',
    basis: 'Upfront capex grant on the electrolyzer block',
    note: 'The actual Dutch OWE rules are award- and project-specific. The app applies the selected share to electrolyzer CAPEX only.',
    cashflowType: 'capex_share',
    eligibleCapexBasis: 'electrolyzer',
    inputs: [
      {
        key: 'nlOweH2CapexGrantShare',
        label: 'OWE capex grant share',
        min: 0,
        max: 0.80,
        step: 0.05,
        defaultValue: 0,
        format: 'share',
      },
    ],
  },

  nl_owe_h2_opex: {
    label: 'Netherlands OWE H2 opex',
    selectLabel: 'Netherlands OWE H2 opex',
    jurisdiction: 'Netherlands',
    policyLayer: 'National',
    technology: 'Renewable hydrogen',
    simulatorTreatment: 'auction_user_input',
    supportFamily: 'operating_gap_payment',
    supportTiming: 'Annual operating cash flow',
    durationYears: 10,
    competitiveFlag: 1,
    referencePriceRequired: 1,
    carbonIntensityGate: 0,
    renewableAttributeGate: 1,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Cannot receive OWE 2024 if the same electrolyzer already received SDE++ or OWE 2023 support.',
    implementationFormula: 'support_t = verified_H2_kg_t * max(production_price_t - correction_amount_t, 0)',
    basis: 'Net H2-output support equal to awarded production price minus correction amount',
    note: 'Enter the awarded production-price bridge and the expected correction amount in model-currency-per-kg terms.',
    cashflowType: 'base_minus_correction',
    outputBasis: 'hydrogen_kg',
    inputs: [
      {
        key: 'nlOweH2ProductionPricePerKg',
        label: 'OWE production price ($/kg equivalent)',
        min: 0,
        max: 9,
        step: 0.05,
        defaultValue: 0,
        format: 'currency_per_kg',
      },
      {
        key: 'nlOweH2CorrectionAmountPerKg',
        label: 'OWE correction amount ($/kg equivalent)',
        min: 0,
        max: 9,
        step: 0.05,
        defaultValue: 0,
        format: 'currency_per_kg',
      },
    ],
  },

  uk_cfd_solar_ar7: {
    label: 'UK solar CfD',
    selectLabel: 'UK solar CfD',
    jurisdiction: 'United Kingdom',
    policyLayer: 'National',
    technology: 'Solar electricity',
    simulatorTreatment: 'auction_user_input',
    supportFamily: 'two_way_cfd',
    supportTiming: 'Annual operating cash flow',
    durationYears: 20,
    competitiveFlag: 1,
    referencePriceRequired: 1,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Can coexist with other support only where scheme rules permit.',
    implementationFormula: 'support_t = eligible_MWh_t * (strike_price_t - reference_price_t)',
    basis: 'Two-way solar CfD on annual PV output',
    note: 'Enter a strike and reference price in model-currency-per-MWh terms. If the reference exceeds the strike, the modeled support turns negative.',
    cashflowType: 'strike_minus_reference',
    outputBasis: 'solar_mwh',
    inputs: [
      {
        key: 'ukCfdSolarStrikePricePerMwh',
        label: 'CfD strike price ($/MWh equivalent)',
        min: 0,
        max: 250,
        step: 0.5,
        defaultValue: 65.23,
        format: 'currency_per_mwh',
      },
      {
        key: 'ukCfdSolarReferencePricePerMwh',
        label: 'CfD reference price ($/MWh equivalent)',
        min: 0,
        max: 250,
        step: 0.5,
        defaultValue: 50,
        format: 'currency_per_mwh',
      },
    ],
  },

  uk_hpbm_h2: {
    label: 'UK Hydrogen Production Business Model',
    selectLabel: 'UK Hydrogen Production Business Model',
    jurisdiction: 'United Kingdom',
    policyLayer: 'National',
    technology: 'Low-carbon / renewable hydrogen',
    simulatorTreatment: 'auction_user_input',
    supportFamily: 'two_way_gap_contract',
    supportTiming: 'Annual operating cash flow',
    durationYears: 15,
    competitiveFlag: 1,
    referencePriceRequired: 1,
    carbonIntensityGate: 0,
    renewableAttributeGate: 1,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Can be paired with Net Zero Hydrogen Fund capex grants.',
    implementationFormula: 'support_t = verified_H2_output_t * contract_gap_payment_t',
    basis: 'User-entered H2 gap payment on qualifying hydrogen output',
    note: 'The actual contract is CfD-like. The app uses the realized gap payment per kilogram as the user-entered operating-support value.',
    cashflowType: 'unit_support',
    outputBasis: 'hydrogen_kg',
    inputs: [
      {
        key: 'ukHpbmHydrogenGapPerKg',
        label: 'HPBM gap payment ($/kg equivalent)',
        min: 0,
        max: 10,
        step: 0.05,
        defaultValue: 0,
        format: 'currency_per_kg',
      },
    ],
  },

  uk_ggr_dac: {
    label: 'UK GGR DAC CfD',
    selectLabel: 'UK GGR DAC CfD',
    jurisdiction: 'United Kingdom',
    policyLayer: 'National',
    technology: 'Direct air capture / greenhouse gas removals',
    simulatorTreatment: 'auction_user_input',
    supportFamily: 'two_way_cfd_carbon_removal',
    supportTiming: 'Annual operating cash flow',
    durationYears: 15,
    competitiveFlag: 1,
    referencePriceRequired: 1,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Separate grant support or transport-and-storage terms may also apply.',
    implementationFormula: 'support_t = issued_credits_t * (strike_price_t - reference_price_t)',
    basis: 'Two-way DAC CfD on annual removal output',
    note: 'Enter a strike and reference carbon-removal price in model-currency-per-ton terms. The modeled support becomes negative if the reference price rises above strike.',
    cashflowType: 'strike_minus_reference',
    outputBasis: 'co2_ton',
    inputs: [
      {
        key: 'ukGgrDacStrikePricePerTon',
        label: 'GGR strike price ($/tCO2 equivalent)',
        min: 0,
        max: 500,
        step: 5,
        defaultValue: 0,
        format: 'currency_per_ton',
      },
      {
        key: 'ukGgrDacReferencePricePerTon',
        label: 'GGR reference price ($/tCO2 equivalent)',
        min: 0,
        max: 500,
        step: 5,
        defaultValue: 0,
        format: 'currency_per_ton',
      },
    ],
  },

  es_h2_aaas: {
    label: 'Spain H2 Auctions-as-a-Service',
    selectLabel: 'Spain H2 Auctions-as-a-Service',
    jurisdiction: 'Spain',
    policyLayer: 'National',
    technology: 'Renewable hydrogen',
    simulatorTreatment: 'auction_user_input',
    supportFamily: 'fixed_premium_per_kg',
    supportTiming: 'Annual operating cash flow',
    durationYears: 10,
    competitiveFlag: 1,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 1,
    domesticContentOrLocationBonus: 'No',
    stackingOrExclusivity: 'Stacking is subject to scheme and state-aid rules.',
    implementationFormula: 'support_t = verified_RFNBO_H2_kg_t * auction_premium_per_kg',
    basis: 'Bid-based H2 premium on qualifying RFNBO output',
    note: 'Enter the assumed awarded premium. The actual Spanish program is auction-cleared and RFNBO-gated.',
    cashflowType: 'unit_support',
    outputBasis: 'hydrogen_kg',
    inputs: [
      {
        key: 'esHydrogenAaasPremiumPerKg',
        label: 'Spanish H2 premium ($/kg equivalent)',
        min: 0,
        max: 10,
        step: 0.05,
        defaultValue: 0,
        format: 'currency_per_kg',
      },
    ],
  },

  eu_rediii: {
    label: 'EU RED III',
    selectLabel: 'EU RED III',
    jurisdiction: 'European Union',
    policyLayer: 'EU-wide',
    technology: 'Renewables / hydrogen',
    simulatorTreatment: 'framework_only',
    supportFamily: 'framework_only',
    supportTiming: 'Eligibility / permitting backdrop',
    durationYears: null,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No direct cash support',
    stackingOrExclusivity: 'No direct cash support is modeled.',
    implementationFormula: 'No direct support cash flow.',
    basis: 'Regulatory backdrop only; no direct cash flow',
    note: 'Use this to tag the scenario with the current EU renewable-target and permitting backdrop without changing project cash flow.',
    cashflowType: 'framework_only',
  },

  eu_cisaf: {
    label: 'EU CISAF',
    selectLabel: 'EU CISAF',
    jurisdiction: 'European Union',
    policyLayer: 'EU-wide',
    technology: 'Clean industry incl. renewables / hydrogen',
    simulatorTreatment: 'framework_only',
    supportFamily: 'framework_only',
    supportTiming: 'State-aid backdrop',
    durationYears: null,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No direct cash support',
    stackingOrExclusivity: 'No direct cash support is modeled.',
    implementationFormula: 'No direct support cash flow.',
    basis: 'State-aid backdrop only; no direct cash flow',
    note: 'Use this when you want the scenario tagged with the post-2025 clean-industry state-aid framework but do not want to invent a tariff.',
    cashflowType: 'framework_only',
  },

  eu_crcf: {
    label: 'EU CRCF',
    selectLabel: 'EU CRCF',
    jurisdiction: 'European Union',
    policyLayer: 'EU-wide',
    technology: 'Carbon removals incl. DACCS',
    simulatorTreatment: 'framework_only',
    supportFamily: 'framework_only',
    supportTiming: 'Certification backdrop',
    durationYears: null,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No direct cash support',
    stackingOrExclusivity: 'No direct cash support is modeled.',
    implementationFormula: 'No direct support cash flow.',
    basis: 'Certification backdrop only; no direct cash flow',
    note: 'Use this to reflect that CRCF-style certification may matter for removal-credit monetization without adding a direct subsidy.',
    cashflowType: 'framework_only',
  },

  eu_rfnbo_rules: {
    label: 'EU RFNBO rules',
    selectLabel: 'EU RFNBO rules',
    jurisdiction: 'European Union',
    policyLayer: 'EU-wide',
    technology: 'Renewable hydrogen',
    simulatorTreatment: 'framework_only',
    supportFamily: 'framework_only',
    supportTiming: 'Eligibility backdrop',
    durationYears: null,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 1,
    domesticContentOrLocationBonus: 'No direct cash support',
    stackingOrExclusivity: 'No direct cash support is modeled.',
    implementationFormula: 'No direct support cash flow.',
    basis: 'Eligibility backdrop only; no direct cash flow',
    note: 'Use this when RFNBO qualification matters for scenario framing but the app should not add a direct premium on its own.',
    cashflowType: 'framework_only',
  },

  eu_ets_if: {
    label: 'EU ETS / Innovation Fund backdrop',
    selectLabel: 'EU ETS / Innovation Fund backdrop',
    jurisdiction: 'European Union',
    policyLayer: 'EU-wide',
    technology: 'Cross-technology',
    simulatorTreatment: 'framework_only',
    supportFamily: 'framework_only',
    supportTiming: 'Carbon-price / grant-source backdrop',
    durationYears: null,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No direct cash support',
    stackingOrExclusivity: 'No direct cash support is modeled.',
    implementationFormula: 'No direct support cash flow.',
    basis: 'Carbon-price and funding-source backdrop only; no direct cash flow',
    note: 'Use this for scenario labeling when you want EU ETS context without directly adding a carbon-price or grant cash flow.',
    cashflowType: 'framework_only',
  },

  us_transfer_directpay: {
    label: 'US transferability / direct pay',
    selectLabel: 'US transferability / direct pay',
    jurisdiction: 'United States',
    policyLayer: 'Federal',
    technology: '48E / 45Y / 45V / 45Q monetization',
    simulatorTreatment: 'framework_only',
    supportFamily: 'framework_only',
    supportTiming: 'Monetization backdrop',
    durationYears: null,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'No direct cash support',
    stackingOrExclusivity: 'No direct cash support is modeled.',
    implementationFormula: 'No direct support cash flow.',
    basis: 'Monetization backdrop only; no direct cash flow',
    note: 'Use this to remind yourself that tax-credit transferability or elective pay may reduce monetization friction without changing the headline support value.',
    cashflowType: 'framework_only',
  },

  custom: {
    label: 'Custom mixed support',
    selectLabel: 'Custom mixed support',
    jurisdiction: 'User-defined',
    policyLayer: 'User-defined',
    technology: 'Cross-technology',
    simulatorTreatment: 'custom_user_input',
    supportFamily: 'custom_mixed',
    supportTiming: 'Close + annual operating cash flow',
    durationYears: null,
    competitiveFlag: 0,
    referencePriceRequired: 0,
    carbonIntensityGate: 0,
    renewableAttributeGate: 0,
    domesticContentOrLocationBonus: 'User-defined',
    stackingOrExclusivity: 'Custom mode can stack the entered capex, solar, H2, and CO2 support terms.',
    implementationFormula: 'support_t0 = total_capex * custom_grant_share; annual_support_t = solar_MWh_t * custom_solar_support + H2_kg_t * custom_H2_support + CO2_t_t * custom_CO2_support',
    basis: 'User-entered stacked capex and output support',
    note: 'Capex support is applied to total installed CAPEX. Annual solar support is entered per MWh, while H2 and CO2 support are entered per kg and per ton.',
    cashflowType: 'custom_composite',
    eligibleCapexBasis: 'total',
    inputs: [
      {
        key: 'customCapexGrantShare',
        label: 'Custom capex support share',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0,
        format: 'share',
      },
      {
        key: 'customSolarSupportPerMwh',
        label: 'Custom solar support ($/MWh)',
        min: -200,
        max: 300,
        step: 1,
        defaultValue: 0,
        format: 'currency_per_mwh',
      },
      {
        key: 'customH2Credit',
        label: 'Custom H2 support ($/kg)',
        min: -5,
        max: 10,
        step: 0.05,
        defaultValue: 0,
        format: 'currency_per_kg',
      },
      {
        key: 'customCo2Credit',
        label: 'Custom CO2 support ($/tCO2)',
        min: -250,
        max: 500,
        step: 5,
        defaultValue: 0,
        format: 'currency_per_ton',
      },
    ],
  },
};

const LEGACY_POLICY_MODE_ALIASES = {
  us_45v_tier4: state => ({
    policyMode: 'us_45v_h2',
    us45vHydrogenCreditPerKg: getFiniteOrDefault(
      state.us45vHydrogenCreditPerKg,
      3.00
    ),
  }),
  us_45v_tier3: state => ({
    policyMode: 'us_45v_h2',
    us45vHydrogenCreditPerKg: getFiniteOrDefault(
      state.us45vHydrogenCreditPerKg,
      1.00
    ),
  }),
  us_45v_tier2: state => ({
    policyMode: 'us_45v_h2',
    us45vHydrogenCreditPerKg: getFiniteOrDefault(
      state.us45vHydrogenCreditPerKg,
      0.75
    ),
  }),
  us_45v_tier1: state => ({
    policyMode: 'us_45v_h2',
    us45vHydrogenCreditPerKg: getFiniteOrDefault(
      state.us45vHydrogenCreditPerKg,
      0.60
    ),
  }),
  us_45q_utilization: state => ({
    policyMode: 'us_45q_dac',
    us45qDacCreditPerTon: getFiniteOrDefault(
      state.us45qDacCreditPerTon,
      130
    ),
  }),
  us_45q_sequestration: state => ({
    policyMode: 'us_45q_dac',
    us45qDacCreditPerTon: getFiniteOrDefault(
      state.us45qDacCreditPerTon,
      180
    ),
  }),
  eu_hydrogen_bank: state => ({
    policyMode: 'eu_ehb_rfnbo',
    euHydrogenBankPremiumPerKg: getFiniteOrDefault(
      state.euHydrogenBankPremiumPerKg,
      getFiniteOrDefault(state.customH2Credit, 0)
    ),
  }),
};

function getFiniteOrDefault(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sumValues(values) {
  return Object.values(values || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function getStepPrecision(step) {
  if (!Number.isFinite(step) || Number.isInteger(step)) return 0;
  const normalized = String(step).toLowerCase();
  if (normalized.includes('e-')) {
    return parseInt(normalized.split('e-')[1], 10);
  }
  return normalized.includes('.') ? normalized.split('.')[1].length : 0;
}

function formatFixed(value, digits) {
  return Number(value).toFixed(Math.max(0, digits));
}

function formatSupportFamily(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, match => match.toUpperCase());
}

function buildPolicyInputFields() {
  const seen = new Set();
  const fields = [];

  Object.values(POLICY_SCHEMES).forEach(policy => {
    (policy.inputs || []).forEach(input => {
      if (seen.has(input.key)) return;
      seen.add(input.key);
      fields.push({
        key: input.key,
        type: 'number',
        min: input.min,
        max: input.max,
        defaultValue: input.defaultValue,
      });
    });
  });

  return fields;
}

const POLICY_INPUT_FIELDS = buildPolicyInputFields();

function getPolicyScheme(mode) {
  return POLICY_SCHEMES[mode] || POLICY_SCHEMES.none;
}

function getPolicySelectGroups() {
  return POLICY_SELECT_GROUPS.map(group => ({
    label: group.label,
    options: group.ids
      .map(id => {
        const scheme = POLICY_SCHEMES[id];
        return scheme ? { id, label: scheme.selectLabel || scheme.label } : null;
      })
      .filter(Boolean),
  })).filter(group => group.options.length);
}

function normalizeLegacyPolicyState(rawState = {}) {
  const input = rawState && typeof rawState === 'object' ? rawState : {};
  const migrated = { ...input };
  const alias = LEGACY_POLICY_MODE_ALIASES[migrated.policyMode];

  if (typeof alias === 'function') {
    Object.assign(migrated, alias(migrated));
  }

  return migrated;
}

function getPolicyInputValue(state, input) {
  return getFiniteOrDefault(state?.[input.key], input.defaultValue);
}

function formatPolicyInputValue(input, value) {
  const precision = getStepPrecision(input.step);
  const numeric = getFiniteOrDefault(value, input.defaultValue);

  switch (input.format) {
    case 'share':
      return `${formatFixed(numeric * 100, Math.max(0, precision - 2))}%`;
    case 'currency_per_kwh':
      return `$${formatFixed(numeric, Math.max(3, precision))}/kWh`;
    case 'currency_per_mwh':
      return `$${formatFixed(numeric, Math.max(0, precision))}/MWh`;
    case 'currency_per_kg':
      return `$${formatFixed(numeric, Math.max(2, precision))}/kg`;
    case 'currency_per_ton':
      return `$${formatFixed(numeric, Math.max(0, precision))}/tCO2`;
    default:
      return formatFixed(numeric, precision);
  }
}

function getPolicyInputDetails(state, scheme) {
  return (scheme.inputs || []).map(input => {
    const value = getPolicyInputValue(state, input);
    return {
      ...input,
      value,
      formattedValue: formatPolicyInputValue(input, value),
    };
  });
}

function getEligibleCapexBreakdown(basis, capex = {}) {
  if (basis === 'solar') {
    return { solar: capex.solar || 0 };
  }
  if (basis === 'electrolyzer') {
    return { electrolyzer: capex.electrolyzer || 0 };
  }
  if (basis === 'dac') {
    return { dac: capex.dac || 0 };
  }
  if (basis === 'total') {
    return {
      solar: capex.solar || 0,
      battery: capex.battery || 0,
      ai: capex.ai || 0,
      electrolyzer: capex.electrolyzer || 0,
      dac: capex.dac || 0,
      sabatier: capex.sabatier || 0,
      methanol: capex.methanol || 0,
      exploratory: capex.exploratory || 0,
    };
  }

  return {};
}

function allocateUpfrontSupport(totalSupport, breakdown = {}) {
  const eligibleTotal = sumValues(breakdown);
  if (!Number.isFinite(totalSupport) || totalSupport <= 0 || eligibleTotal <= 0) {
    return Object.fromEntries(Object.keys(breakdown).map(key => [key, 0]));
  }

  const keys = Object.keys(breakdown);
  let allocated = 0;
  return keys.reduce((result, key, index) => {
    const basisValue = Math.max(0, Number(breakdown[key]) || 0);
    const value = index === (keys.length - 1)
      ? Math.max(0, totalSupport - allocated)
      : (totalSupport * basisValue) / eligibleTotal;
    allocated += value;
    result[key] = value;
    return result;
  }, {});
}

function getOutputMetric(outputBasis, context = {}) {
  const solarAnnualMwh = Math.max(0, Number(context?.solar?.annualMWh) || 0);
  const hydrogenAnnualKg = context?.electrolyzer?.enabled
    ? Math.max(0, Number(context?.electrolyzer?.h2AnnualKg) || 0)
    : 0;
  const co2AnnualTons = context?.dac?.enabled
    ? Math.max(0, Number(context?.dac?.co2AnnualTons) || 0)
    : 0;

  switch (outputBasis) {
    case 'solar_kwh':
      return {
        label: 'Eligible solar output',
        unit: 'kWh/yr',
        value: solarAnnualMwh * 1000,
      };
    case 'solar_mwh':
      return {
        label: 'Eligible solar output',
        unit: 'MWh/yr',
        value: solarAnnualMwh,
      };
    case 'hydrogen_kg':
      return {
        label: 'Eligible hydrogen output',
        unit: 'kg/yr',
        value: hydrogenAnnualKg,
      };
    case 'co2_ton':
      return {
        label: 'Eligible CO2 output',
        unit: 'tCO2/yr',
        value: co2AnnualTons,
      };
    default:
      return {
        label: 'Eligible output',
        unit: '',
        value: 0,
      };
  }
}

function getEligibleCapexLabel(basis) {
  switch (basis) {
    case 'solar':
      return 'Eligible solar CAPEX';
    case 'electrolyzer':
      return 'Eligible electrolyzer CAPEX';
    case 'dac':
      return 'Eligible DAC CAPEX';
    case 'total':
      return 'Eligible project CAPEX';
    default:
      return 'Eligible CAPEX';
  }
}

function evaluatePolicy(state = {}, context = {}) {
  const scheme = getPolicyScheme(state.policyMode);
  const inputs = getPolicyInputDetails(state, scheme);
  const capexBreakdown = getEligibleCapexBreakdown(scheme.eligibleCapexBasis, context.capex || {});
  const eligibleCapex = sumValues(capexBreakdown);
  const outputMetric = getOutputMetric(scheme.outputBasis, context);

  let annualSupport = 0;
  let upfrontSupport = 0;
  let effectiveUnitSupport = 0;
  const componentValues = {};

  switch (scheme.cashflowType) {
    case 'capex_share': {
      const rate = inputs[0]?.value || 0;
      effectiveUnitSupport = rate;
      upfrontSupport = eligibleCapex * rate;
      break;
    }

    case 'unit_support': {
      const supportPerUnit = inputs[0]?.value || 0;
      effectiveUnitSupport = supportPerUnit;
      annualSupport = outputMetric.value * supportPerUnit;
      break;
    }

    case 'strike_minus_reference': {
      const strike = inputs[0]?.value || 0;
      const reference = inputs[1]?.value || 0;
      effectiveUnitSupport = strike - reference;
      annualSupport = outputMetric.value * effectiveUnitSupport;
      break;
    }

    case 'base_minus_correction': {
      const baseAmount = inputs[0]?.value || 0;
      const correctionAmount = inputs[1]?.value || 0;
      effectiveUnitSupport = Math.max(baseAmount - correctionAmount, 0);
      annualSupport = outputMetric.value * effectiveUnitSupport;
      break;
    }

    case 'custom_composite': {
      const capexShare = inputs.find(input => input.key === 'customCapexGrantShare')?.value || 0;
      const solarSupportPerMwh = inputs.find(input => input.key === 'customSolarSupportPerMwh')?.value || 0;
      const h2SupportPerKg = inputs.find(input => input.key === 'customH2Credit')?.value || 0;
      const co2SupportPerTon = inputs.find(input => input.key === 'customCo2Credit')?.value || 0;
      const solarAnnualMwh = Math.max(0, Number(context?.solar?.annualMWh) || 0);
      const hydrogenAnnualKg = context?.electrolyzer?.enabled
        ? Math.max(0, Number(context?.electrolyzer?.h2AnnualKg) || 0)
        : 0;
      const co2AnnualTons = context?.dac?.enabled
        ? Math.max(0, Number(context?.dac?.co2AnnualTons) || 0)
        : 0;

      upfrontSupport = sumValues(context.capex || {}) * capexShare;
      componentValues.solar = solarAnnualMwh * solarSupportPerMwh;
      componentValues.hydrogen = hydrogenAnnualKg * h2SupportPerKg;
      componentValues.co2 = co2AnnualTons * co2SupportPerTon;
      annualSupport = sumValues(componentValues);
      break;
    }

    case 'framework_only':
    case 'none':
    default:
      break;
  }

  return {
    mode: state.policyMode,
    label: scheme.label,
    applicability: scheme.jurisdiction,
    policyLayer: scheme.policyLayer,
    technology: scheme.technology,
    simulatorTreatment: scheme.simulatorTreatment,
    supportFamily: scheme.supportFamily,
    supportFamilyLabel: formatSupportFamily(scheme.supportFamily),
    supportTiming: scheme.supportTiming,
    durationYears: Number.isFinite(scheme.durationYears) ? scheme.durationYears : null,
    competitiveFlag: scheme.competitiveFlag,
    referencePriceRequired: Boolean(scheme.referencePriceRequired),
    carbonIntensityGate: Boolean(scheme.carbonIntensityGate),
    renewableAttributeGate: Boolean(scheme.renewableAttributeGate),
    domesticContentOrLocationBonus: scheme.domesticContentOrLocationBonus,
    basis: scheme.basis,
    note: scheme.note,
    stackingRule: scheme.stackingOrExclusivity,
    implementationFormula: scheme.implementationFormula,
    annualSupport,
    upfrontSupport,
    total: annualSupport,
    effectiveUnitSupport,
    outputBasis: scheme.outputBasis || null,
    outputMetric,
    eligibleCapexBasis: scheme.eligibleCapexBasis || null,
    eligibleCapex,
    eligibleCapexLabel: getEligibleCapexLabel(scheme.eligibleCapexBasis),
    upfrontSupportByCapexKey: allocateUpfrontSupport(upfrontSupport, capexBreakdown),
    capexBreakdown,
    inputValues: inputs,
    componentValues,
    frameworkOnly: scheme.cashflowType === 'framework_only',
  };
}

const PolicyModel = {
  getInputDetails: getPolicyInputDetails,
  getScheme: getPolicyScheme,
  getSelectGroups: getPolicySelectGroups,
  normalizeLegacyState: normalizeLegacyPolicyState,
  evaluate: evaluatePolicy,
  formatInputValue: formatPolicyInputValue,
};
