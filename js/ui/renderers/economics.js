/* Economics breakdown panel: one builder per collapsible row group */

import { FormatNumbers } from '../format-numbers.js';
import { formatIrrWithStatus, formatMirr, formatSystemSizeMW } from '../formatters.js';
import { econGroup, econMetric, econRow, EDUCATIONAL_TOOLTIPS } from './markup.js';

const money = FormatNumbers.formatMoney;
const signClass = value => (value >= 0 ? 'positive' : 'negative');
const irrClass = irr => (Number.isFinite(irr) ? signClass(irr) : '');
const NO_INVESTMENT_LABEL = 'n/a (no net investment)';
const formatPaybackShort = (years, noNetInvestment = false) => (
  noNetInvestment ? NO_INVESTMENT_LABEL : Number.isFinite(years) ? `${FormatNumbers.fixed(years, 1)} yrs` : 'N/A'
);
const formatPaybackLong = (years, noNetInvestment = false) => (
  noNetInvestment ? NO_INVESTMENT_LABEL : Number.isFinite(years) ? `${FormatNumbers.fixed(years, 1)} years` : 'N/A'
);
// The IRR tooltip explains why no IRR is shown when the model withholds it.
const irrTooltip = (value, analysis, fallback) => (
  Number.isFinite(value) ? fallback : `${analysis?.reason || ''} ${fallback}`.trim()
);

// m3 routes price per m3 with cents; everything else per ton.
const exploratoryPriceLabel = module => {
  const priceDigits = module.outputUnit === 'm3' ? 2 : 0;
  const unitSuffix = module.outputUnit === 'm3' ? 'm3' : 'ton';
  return `$${FormatNumbers.fixed(module.unitPrice, priceDigits)}/${unitSuffix}`;
};

const hasSponsorSupport = financing => !financing.canFullyCoverDebtService && financing.sponsorSupportTotal > 0;

function projectLabels(financing) {
  return {
    npv: financing.enabled ? 'Project NPV' : 'NPV',
    irr: financing.enabled ? 'Project IRR' : 'IRR',
    payback: financing.enabled ? 'Project payback' : 'Payback',
    mirr: financing.enabled ? 'Equity MIRR' : 'MIRR',
    sustainedPayback: financing.enabled ? 'Sustained project payback' : 'Sustained payback',
  };
}

function buildSummaryMetrics({ e, labels }) {
  const metrics = [
    econMetric(
      'Total CAPEX',
      money(e.totalCapex),
      '',
      'Installed build cost',
      'All upfront installed project cost before any upfront incentive support.'
    ),
    econMetric(
      'Annual revenue',
      money(e.totalAnnualRevenue),
      signClass(e.totalAnnualRevenue),
      'Product sales plus any annual operating support',
      'Expected yearly revenue from products plus any modeled operating support.'
    ),
    econMetric(
      'Levelized cost',
      money(e.annualCost),
      'negative',
      'CRF capital + O&M',
      'Equivalent yearly cost combining annualized capital charges and fixed O&M.'
    ),
    econMetric(
      'Annual profit',
      money(e.annualProfit),
      signClass(e.annualProfit),
      'Revenue minus levelized cost',
      'Annual revenue minus total levelized annual cost.'
    ),
    econMetric(
      labels.npv,
      money(e.npv),
      signClass(e.npv),
      e.totalReplacementOutflows > 0
        ? `Includes ${money(e.totalReplacementOutflows)} replacements`
        : 'Discounted project cash flow',
      'Discounted value of project cash flows over the selected analysis horizon.'
    ),
    econMetric(
      labels.irr,
      formatIrrWithStatus(e.projectIrr, e.projectIrrAnalysis),
      irrClass(e.projectIrr),
      `${labels.payback}: ${formatPaybackShort(e.paybackYears, e.noNetInvestment)}`,
      irrTooltip(e.projectIrr, e.projectIrrAnalysis, EDUCATIONAL_TOOLTIPS.projectIrr)
    ),
  ];

  if (e.financing.enabled) {
    metrics.push(
      econMetric(
        'Equity IRR',
        formatIrrWithStatus(e.equityIrr, e.equityIrrAnalysis),
        irrClass(e.equityIrr),
        `Equity payback: ${formatPaybackShort(e.equityPaybackYears)}`,
        irrTooltip(e.equityIrr, e.equityIrrAnalysis, EDUCATIONAL_TOOLTIPS.equityIrr)
      )
    );
  }
  metrics.push(
    econMetric(
      labels.mirr,
      formatMirr(e.mirr),
      irrClass(Number.isFinite(e.mirr) ? e.mirr - e.discountRatePercent : NaN),
      `Finance + reinvest at ${FormatNumbers.fixed(e.discountRatePercent, 1)}%`,
      EDUCATIONAL_TOOLTIPS.mirr
    )
  );
  return metrics;
}

// A sustained payback is only worth showing when it differs from the simple one.
function differsFromSimplePayback(sustainedYears, simpleYears) {
  return Number.isFinite(sustainedYears)
    ? Math.abs(sustainedYears - simpleYears) > 1e-6
    : Number.isFinite(simpleYears);
}

function buildReturnsRows({ e, labels }) {
  const rows = [
    econRow(
      'Annual profit (levelized)',
      money(e.annualProfit),
      signClass(e.annualProfit),
      'Revenue minus total levelized annual cost (capital recovery + O&M).'
    ),
    econRow(
      labels.npv,
      money(e.npv),
      signClass(e.npv),
      'Discounted cash flows: gross upfront CAPEX less any close-date policy support in year 0, then yearly revenue minus O&M and any scheduled replacement CAPEX. CRF capital recovery is not repeated as a cash outflow.'
    ),
    econRow(
      labels.irr,
      formatIrrWithStatus(e.projectIrr, e.projectIrrAnalysis),
      irrClass(e.projectIrr),
      irrTooltip(e.projectIrr, e.projectIrrAnalysis, 'Internal rate of return on the same net-cash path as NPV after O&M, close-date policy support, and scheduled replacements.')
    ),
    econRow(
      e.financing.enabled ? 'Project MIRR' : 'MIRR',
      formatMirr(e.projectMirr),
      irrClass(Number.isFinite(e.projectMirr) ? e.projectMirr - e.discountRatePercent : NaN),
      `Modified IRR of the project cash flows with outflows financed and inflows reinvested at the ${FormatNumbers.fixed(e.discountRatePercent, 1)}% discount rate.`
    ),
  ];

  if (e.financing.enabled) {
    rows.push(
      econRow(
        'Equity IRR',
        formatIrrWithStatus(e.equityIrr, e.equityIrrAnalysis),
        irrClass(e.equityIrr),
        irrTooltip(e.equityIrr, e.equityIrrAnalysis, 'IRR on sponsor equity cash flows: upfront equity plus financing fees in year 0, then project net cash after scheduled debt service. With high debt shares this rate is inflated by later sponsor injections; compare the equity MIRR.')
      ),
      econRow(
        'Equity MIRR',
        formatMirr(e.equityMirr),
        irrClass(Number.isFinite(e.equityMirr) ? e.equityMirr - e.discountRatePercent : NaN),
        `Modified IRR of the sponsor equity cash flows at the ${FormatNumbers.fixed(e.discountRatePercent, 1)}% discount rate; unlike equity IRR it does not reward leverage for compounding at its own rate.`
      )
    );
  }

  rows.push(
    econRow(
      labels.payback,
      formatPaybackLong(e.paybackYears, e.noNetInvestment),
      '',
      'Simple payback on cumulative net cash versus upfront CAPEX. This is the first point where cumulative net cash turns positive.'
    )
  );
  if (differsFromSimplePayback(e.sustainedPaybackYears, e.paybackYears)) {
    rows.push(
      econRow(
        labels.sustainedPayback,
        formatPaybackLong(e.sustainedPaybackYears),
        '',
        'Payback only if the project stays cumulative-cash positive through the full selected horizon after scheduled replacements.'
      )
    );
  }
  if (e.financing.enabled) {
    rows.push(
      econRow(
        'Equity payback',
        formatPaybackLong(e.equityPaybackYears),
        '',
        'Simple payback on cumulative sponsor equity cash after scheduled debt service.'
      )
    );
    if (differsFromSimplePayback(e.sustainedEquityPaybackYears, e.equityPaybackYears)) {
      rows.push(
        econRow(
          'Sustained equity payback',
          formatPaybackLong(e.sustainedEquityPaybackYears),
          '',
          'Equity payback only if sponsor cash stays cumulative-positive through the full selected horizon after debt service and replacements.'
        )
      );
    }
  }
  if (e.totalReplacementOutflows > 0) {
    rows.push(
      econRow(
        'Scheduled replacements',
        money(e.totalReplacementOutflows),
        'negative',
        'Full equipment replacement CAPEX that lands inside the selected analysis horizon and is included in NPV, IRR, ROI, and payback.'
      )
    );
  }
  return rows;
}

function buildCostRows({ r, e, state }) {
  const solarBreakdown = e.capexBreakdown || {};
  const exploratoryDetails = e.exploratoryDetails || [];
  const rows = [
    econRow('Annualized cost build', '', 'header'),
    econRow(
      'Capital recovery',
      money(e.annualizedCapexTotal),
      'negative',
      `Upfront CAPEX x capital recovery factor at ${FormatNumbers.fixed(state.discountRate, 1)}% and each asset's book life. This is the economic annual capital charge, not straight-line depreciation.`
    ),
  ];
  if (r.ai.enabled && r.ai.annualOM > 0) {
    rows.push(econRow('AI fixed O&M', money(r.ai.annualOM), 'negative'));
  }
  exploratoryDetails.forEach(module => {
    if (module.annualOM <= 0) return;
    rows.push(econRow(`${module.label} O&M`, money(module.annualOM), 'negative'));
  });
  rows.push(
    econRow('Total O&M', money(e.annualOM), 'negative'),
    econRow('Total levelized annual cost', money(e.annualCost), 'total')
  );

  rows.push(
    econRow('Installed CAPEX', '', 'header'),
    econRow('Solar modules', money(solarBreakdown.solarModules || 0)),
    econRow(
      'Solar structure + install BOS',
      money(solarBreakdown.solarBos || 0),
      '',
      'Balance of system: the non-panel parts of the solar installation, such as mounting structure, inverters, wiring, and installation labor.'
    )
  );
  if ((solarBreakdown.solarLand || 0) > 0) rows.push(econRow('Land acquisition', money(solarBreakdown.solarLand)));
  if ((solarBreakdown.solarSitePrep || 0) > 0) rows.push(econRow('Site prep', money(solarBreakdown.solarSitePrep)));
  rows.push(econRow('Total solar installation', money(e.capex.solar)));
  [
    ['battery', 'Battery'],
    ['ai', 'AI datacenter'],
    ['electrolyzer', 'Electrolyzer'],
    ['dac', 'DAC'],
    ['sabatier', 'Methane reactor'],
    ['methanol', 'Methanol reactor'],
  ].forEach(([key, label]) => {
    if (e.capex[key] > 0) rows.push(econRow(label, money(e.capex[key])));
  });
  exploratoryDetails.forEach(module => {
    if (module.capex <= 0) return;
    rows.push(econRow(`${module.label} (${module.routeLabel})`, money(module.capex)));
  });
  rows.push(econRow('Total CAPEX', money(e.totalCapex), 'total'));
  if (Math.abs(e.policy.upfrontSupport || 0) > 1e-9) {
    rows.push(
      econRow(
        'Upfront incentive support',
        money(e.policy.upfrontSupport),
        'positive',
        'Applied at close as a reduction to eligible upfront CAPEX only. Replacement CAPEX later in life is not automatically subsidized in the current model.'
      ),
      econRow('Net CAPEX at close', money(e.netCapexAtClose), 'total')
    );
  }
  return rows;
}

function buildRevenueRows({ e }) {
  const rows = [];
  if (e.revenue.ai > 0) rows.push(econRow('AI token revenue', money(e.revenue.ai), 'positive'));
  if (e.revenue.methane > 0) {
    rows.push(
      econRow(`Methane sales @ $${FormatNumbers.fixed(e.methaneSalePrice, 2)}/MCF`, money(e.revenue.methane), 'positive')
    );
  }
  if (e.revenue.methanol > 0) rows.push(econRow('Methanol sales', money(e.revenue.methanol), 'positive'));
  (e.exploratoryDetails || []).forEach(module => {
    if (module.annualRevenue <= 0) return;
    rows.push(econRow(`${module.label} sales @ ${exploratoryPriceLabel(module)}`, money(module.annualRevenue), 'positive'));
  });
  if (Math.abs(e.revenue.policyCredits || 0) > 1e-9) {
    rows.push(econRow(e.policy.label, money(e.revenue.policyCredits), signClass(e.revenue.policyCredits)));
  }
  rows.push(econRow('Total revenue', money(e.totalAnnualRevenue), 'total'));
  return rows;
}

function buildFinancingRows({ e }) {
  const financing = e.financing;
  if (!financing.enabled) return [];

  const rows = [
    econRow('Debt share', `${FormatNumbers.fixed(financing.debtSharePercent, 0)}% of upfront CAPEX`),
    econRow('Debt-funded at close', money(financing.debtAmount), 'positive'),
    econRow('Equity-funded CAPEX', money(financing.equityCapex), 'negative'),
  ];
  if (financing.upfrontFee > 0) {
    rows.push(econRow('Upfront financing fee', money(financing.upfrontFee), 'negative'));
  }
  rows.push(
    econRow('Total sponsor cash at close', money(financing.equityUpfront), 'negative'),
    econRow('Debt coupon', `${FormatNumbers.fixed(financing.debtInterestRate, 2)}%`),
    econRow('Debt term', `${FormatNumbers.fixed(financing.debtTermYears, 0)} years`)
  );
  if (financing.totalDebtService > 0) {
    rows.push(
      econRow(
        'Annual debt service',
        money(financing.annualDebtService),
        'negative',
        'Modeled as a level-payment amortizing loan over the selected debt term.'
      ),
      econRow('Total debt interest', money(financing.totalInterest), 'negative')
    );
  }
  if (hasSponsorSupport(financing)) {
    const uncoveredYearsLabel = financing.uncoveredDebtServiceYearCount === 1
      ? '1 year'
      : `${FormatNumbers.fixed(financing.uncoveredDebtServiceYearCount, 0)} years`;
    const peakSupportLabel = financing.peakSponsorSupportYear
      ? `${money(financing.peakSponsorSupport)} in year ${FormatNumbers.fixed(financing.peakSponsorSupportYear, 0)}`
      : money(financing.peakSponsorSupport);
    rows.push(
      econRow(
        'Financing warning',
        `Debt service exceeds operating cash flow in ${uncoveredYearsLabel}`,
        'warning',
        'The model does not default or restructure the debt. It assumes the sponsor contributes extra cash whenever scheduled debt service is higher than project operating cash flow.'
      ),
      econRow(
        'Additional sponsor cash support',
        money(financing.sponsorSupportTotal),
        'warning',
        'Total additional sponsor cash assumed to cover debt-service shortfalls after O&M over the selected analysis horizon.'
      ),
      econRow(
        'Peak annual sponsor support',
        peakSupportLabel,
        'warning',
        'Largest single-year sponsor cash support needed because debt service is higher than project operating cash flow.'
      )
    );
  }
  return rows;
}

function buildUnitRows({ r, e }) {
  const rows = [];
  if (r.ai.enabled) {
    rows.push(
      econRow('Integrated AI cost', `$${FormatNumbers.fixed(e.costPerMToken, 2)} / 1M tokens`),
      econRow(
        'Token margin',
        `${e.tokenMarginPerM >= 0 ? '+' : ''}$${FormatNumbers.fixed(e.tokenMarginPerM, 2)} / 1M`,
        signClass(e.tokenMarginPerM)
      )
    );
  }
  if (e.costPerKgH2 > 0) rows.push(econRow('Integrated H₂ cost', `$${FormatNumbers.fixed(e.costPerKgH2, 2)}/kg`));
  if (e.costPerTonCO2 > 0) rows.push(econRow('Integrated CO₂ cost', `$${FormatNumbers.fixed(e.costPerTonCO2, 0)}/ton`));
  if (e.costPerMCF > 0) rows.push(econRow('Integrated CH₄ cost', `$${FormatNumbers.fixed(e.costPerMCF, 2)}/MCF`));
  return rows;
}

function buildPolicyContextRows({ e }) {
  const policy = e.policy;
  if (policy.mode === 'none') return [];

  const rows = [
    econRow('Incentive scheme', policy.label),
    econRow('Policy scope', policy.applicability),
    econRow('Model treatment', String(policy.simulatorTreatment || '').replace(/_/g, ' ')),
    econRow('Support family', policy.supportFamilyLabel),
  ];
  if (Number.isFinite(policy.durationYears)) {
    rows.push(econRow('Policy duration', `${FormatNumbers.fixed(policy.durationYears, 0)} years`));
  }
  if ((policy.outputMetric?.value || 0) > 0 && policy.outputMetric?.unit) {
    const digits = policy.outputMetric.unit === 'MWh/yr' ? 1 : 0;
    rows.push(
      econRow(
        policy.outputMetric.label,
        `${FormatNumbers.fixed(policy.outputMetric.value, digits)} ${policy.outputMetric.unit}`
      )
    );
  }
  if ((policy.eligibleCapex || 0) > 0) {
    rows.push(econRow(policy.eligibleCapexLabel, money(policy.eligibleCapex)));
  }
  if (Math.abs(policy.upfrontSupport || 0) > 1e-9) {
    rows.push(econRow('Upfront support at close', money(policy.upfrontSupport), 'positive'));
  }
  (policy.inputValues || []).forEach(input => {
    rows.push(econRow(input.label, input.formattedValue));
  });
  if (policy.referencePriceRequired) {
    rows.push(econRow('Reference price required', 'Yes'));
  }
  return rows;
}

function buildExploratoryContextRows({ e }) {
  if (!e.modeledExploratoryModules.length) return [];

  const rows = [econRow('Exploratory routes modeled', e.modeledExploratoryModules.join(', '))];
  if (e.exploratoryDetails.length) {
    rows.push(econRow('Exploratory M&O', `${FormatNumbers.fixed(e.exploratoryDetails[0].omPercent, 1)}% CAPEX/yr`));
  }
  e.exploratoryDetails.forEach(module => {
    const volumeDigits = module.outputUnit === 'm3' ? 0 : 1;
    rows.push(
      econRow(`${module.label} price`, exploratoryPriceLabel(module)),
      econRow(
        `${module.label} CAPEX basis`,
        `$${FormatNumbers.fixed(module.capexBasis, 0)}/${module.capexBasisUnit === 'm3pd' ? 'm3/day' : 'ton/yr capacity'}`
      ),
      econRow(
        `${module.label} output`,
        `${FormatNumbers.fixed(module.annualOutputUnits, volumeDigits)} ${module.outputUnit}/yr`
      )
    );
  });
  return rows;
}

function buildContextRows(context) {
  const { r, e, state, methaneMarket, cycleUnit } = context;
  const rows = [];
  if (e.revenue.ai > 0) {
    rows.push(
      econRow('AI token price', `$${FormatNumbers.fixed(state.aiTokenPricePerM, 2)} / 1M tokens`),
      econRow('AI throughput', `${Math.round(state.aiMillionTokensPerMWh).toLocaleString()} M tokens/MWh`),
      econRow('AI tokens sold', `${FormatNumbers.fixed(r.ai.annualTokensM / 1000, 2)}B /yr`),
      econRow('AI load auto-sized', formatSystemSizeMW(r.ai.designLoadKW / 1000)),
      econRow('Served-energy utilization', `${FormatNumbers.fixed(r.ai.utilization * 100, 2)}%`),
      econRow('Full-rate reliability', `${FormatNumbers.fixed(r.ai.fullPowerReliability * 100, 2)}%`)
    );
  }
  if (e.revenue.methane > 0) {
    rows.push(econRow('Methane market', methaneMarket.applicability));
  }
  rows.push(...buildPolicyContextRows(context));
  if (r.h2Surplus > 0.1) {
    rows.push(econRow('Unused H₂', `${FormatNumbers.fixed(r.h2Surplus, 1)} kg/${cycleUnit}`));
  }
  if (r.co2Surplus > 0.1) {
    rows.push(econRow('Unused CO₂', `${FormatNumbers.fixed(r.co2Surplus, 1)} kg/${cycleUnit}`));
  }
  rows.push(...buildExploratoryContextRows(context));
  return rows;
}

function unitEconomicsSummary({ r, e }) {
  if (r.ai.enabled) return `$${FormatNumbers.fixed(e.costPerMToken, 2)} / 1M tokens`;
  if (e.costPerMCF > 0) return `$${FormatNumbers.fixed(e.costPerMCF, 2)}/MCF`;
  if (e.costPerKgH2 > 0) return `$${FormatNumbers.fixed(e.costPerKgH2, 2)}/kg H₂`;
  if (e.costPerTonCO2 > 0) return `$${FormatNumbers.fixed(e.costPerTonCO2, 0)}/ton CO₂`;
  return 'Per-unit costs';
}

/**
 * HTML for the economics panel.
 * @param {object} r calculation results
 * @param {{ state: object, methaneMarket: object, cycleUnit: string }} options
 */
export function renderEconomicsBreakdown(r, { state, methaneMarket, cycleUnit }) {
  const e = r.economics;
  const context = { r, e, state, methaneMarket, cycleUnit, labels: projectLabels(e.financing) };
  const financingRows = buildFinancingRows(context);
  const unitRows = buildUnitRows(context);
  const contextRows = buildContextRows(context);

  let html = `<div class="econ-summary-grid">${buildSummaryMetrics(context).join('')}</div>`;
  html += econGroup(
    'Project returns',
    `${context.labels.irr} ${formatIrrWithStatus(e.projectIrr, e.projectIrrAnalysis)}`,
    buildReturnsRows(context).join(''),
    'Discounted returns and payback metrics'
  );
  html += econGroup(
    'Cost breakdown',
    `${money(e.annualCost)} /yr`,
    buildCostRows(context).join(''),
    'Annualized cost stack and installed CAPEX'
  );
  html += econGroup(
    'Revenue breakdown',
    `${money(e.totalAnnualRevenue)} /yr`,
    buildRevenueRows(context).join(''),
    'Annual revenue sources by product and operating-support regime'
  );
  if (financingRows.length) {
    const debtShare = `${FormatNumbers.fixed(e.financing.debtSharePercent, 0)}% debt`;
    html += econGroup(
      'Financing details',
      hasSponsorSupport(e.financing) ? `${debtShare} + sponsor support` : debtShare,
      financingRows.join(''),
      'Sponsor cash needs and debt service'
    );
  }
  if (unitRows.length) {
    html += econGroup(
      'Unit economics',
      unitEconomicsSummary(context),
      unitRows.join(''),
      'Integrated cost and margin metrics'
    );
  }
  if (contextRows.length) {
    html += econGroup(
      'Context & routes',
      e.modeledExploratoryModules.length ? 'Assumptions + modeled routes' : 'Assumptions + losses',
      contextRows.join(''),
      'Supporting assumptions behind the headline numbers'
    );
  }
  return html;
}
