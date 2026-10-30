/* ============================================
   Finance primitives
   ============================================
   Capital recovery, degradation, replacement and debt schedules, payback,
   IRR, and the project financing / cash-flow timeline built from them.
   Plain functions (no `this`); the Calc facade re-exposes them as methods. */

export function crf(rate, years) {
  if (!isFinite(rate) || !isFinite(years) || years <= 0) return 0;
  if (rate === 0) return 1 / years;
  return (rate * Math.pow(1 + rate, years)) / (Math.pow(1 + rate, years) - 1);
}

export function getSolarDegradationFactor(degradationPercent, year) {
  if (!Number.isFinite(year) || year <= 1) return 1;
  const annualRetention = Math.max(0, 1 - (Math.max(0, degradationPercent || 0) / 100));
  return Math.pow(annualRetention, year - 1);
}

/* PV output factor in a project year when the array is repowered every
   `solarAssetLife` years (the replacement schedule replaces it at the end
   of each life): degradation restarts from 1 in the first year after each
   replacement. */
export function getSolarFactorForYear(degradationPercent, year, solarAssetLife) {
  const life = Number.isFinite(solarAssetLife) && solarAssetLife >= 1 ? Math.round(solarAssetLife) : Infinity;
  const safeYear = Number.isFinite(year) ? Math.max(1, Math.floor(year)) : 1;
  const ageYears = Number.isFinite(life) ? (safeYear - 1) % life : safeYear - 1;
  return getSolarDegradationFactor(degradationPercent, ageYears + 1);
}

export function getAverageSolarDegradationFactor(degradationPercent, years) {
  if (!Number.isFinite(years) || years <= 0) return 1;
  let totalFactor = 0;
  for (let year = 1; year <= years; year++) {
    totalFactor += getSolarDegradationFactor(degradationPercent, year);
  }
  return totalFactor / years;
}

export function getPolicyDurationFactor(policy, year) {
  if (!policy || !Number.isFinite(policy.durationYears) || policy.durationYears <= 0) return 1;
  return year <= policy.durationYears ? 1 : 0;
}

export function buildReplacementSchedule(analysisHorizonYears, assets) {
  const byYear = {};
  const entries = [];

  for (const asset of assets) {
    if (!asset || !Number.isFinite(asset.cost) || asset.cost <= 0) continue;
    if (!Number.isFinite(asset.lifeYears) || asset.lifeYears <= 0) continue;

    let replacementAt = asset.lifeYears;
    while (replacementAt < analysisHorizonYears - 1e-9) {
      const year = Math.max(1, Math.ceil(replacementAt - 1e-9));
      if (!byYear[year]) {
        byYear[year] = {
          year,
          total: 0,
          items: [],
        };
        entries.push(byYear[year]);
      }

      byYear[year].total += asset.cost;
      byYear[year].items.push({
        key: asset.key,
        label: asset.label,
        cost: asset.cost,
        lifeYears: asset.lifeYears,
        scheduledAtYear: replacementAt,
      });

      replacementAt += asset.lifeYears;
    }
  }

  entries.sort((a, b) => a.year - b.year);

  return {
    byYear,
    entries,
    total: entries.reduce((sum, entry) => sum + entry.total, 0),
  };
}

export function calculateSimplePaybackYears(initialOutflow, yearlyCashFlows) {
  if (!Number.isFinite(initialOutflow) || initialOutflow <= 0) return 0;
  if (!Array.isArray(yearlyCashFlows) || !yearlyCashFlows.length) return Infinity;

  let cumulativeCash = -initialOutflow;
  for (let i = 0; i < yearlyCashFlows.length; i++) {
    const netCashFlow = Number.isFinite(yearlyCashFlows[i]) ? yearlyCashFlows[i] : 0;
    const cumulativeAfter = cumulativeCash + netCashFlow;
    if (netCashFlow > 0 && cumulativeCash < 0 && cumulativeAfter >= 0) {
      return i + ((-cumulativeCash) / netCashFlow);
    }

    cumulativeCash = cumulativeAfter;
  }

  return Infinity;
}

export function calculateSustainedPaybackYears(initialOutflow, yearlyCashFlows) {
  if (!Number.isFinite(initialOutflow) || initialOutflow <= 0) return 0;
  if (!Array.isArray(yearlyCashFlows) || !yearlyCashFlows.length) return Infinity;

  let cumulativeCash = -initialOutflow;
  for (let i = 0; i < yearlyCashFlows.length; i++) {
    const netCashFlow = Number.isFinite(yearlyCashFlows[i]) ? yearlyCashFlows[i] : 0;
    const cumulativeAfter = cumulativeCash + netCashFlow;
    let forwardCumulative = cumulativeAfter;
    let staysPaidBack = forwardCumulative >= -1e-6;

    for (let j = i + 1; staysPaidBack && j < yearlyCashFlows.length; j++) {
      forwardCumulative += Number.isFinite(yearlyCashFlows[j]) ? yearlyCashFlows[j] : 0;
      if (forwardCumulative < -1e-6) staysPaidBack = false;
    }

    if (staysPaidBack && netCashFlow > 0 && cumulativeCash < 0 && cumulativeAfter >= 0) {
      return i + ((-cumulativeCash) / netCashFlow);
    }

    cumulativeCash = cumulativeAfter;
  }

  return Infinity;
}

export function buildDebtSchedule(principal, annualRate, termYears, analysisHorizonYears) {
  const safePrincipal = Number.isFinite(principal) ? Math.max(0, principal) : 0;
  const safeRate = Number.isFinite(annualRate) ? Math.max(0, annualRate) : 0;
  const safeTermYears = Number.isFinite(termYears) ? Math.max(0, Math.round(termYears)) : 0;
  const safeHorizonYears = Number.isFinite(analysisHorizonYears) ? Math.max(0, Math.round(analysisHorizonYears)) : 0;
  const annualDebtService = (safePrincipal > 0 && safeTermYears > 0)
    ? (safeRate === 0 ? safePrincipal / safeTermYears : safePrincipal * crf(safeRate, safeTermYears))
    : 0;
  const schedule = [];
  const byYear = {};
  let balance = safePrincipal;
  let totalInterest = 0;
  let totalPrincipal = 0;
  let totalDebtService = 0;

  for (let year = 1; year <= safeHorizonYears; year++) {
    const startingBalance = balance;
    let interest = 0;
    let principalPaid = 0;
    let debtService = 0;

    if (year <= safeTermYears && startingBalance > 1e-9) {
      interest = startingBalance * safeRate;
      principalPaid = Math.max(0, annualDebtService - interest);
      if (year === safeTermYears || principalPaid > startingBalance) {
        principalPaid = startingBalance;
      }
      debtService = interest + principalPaid;
      balance = Math.max(0, startingBalance - principalPaid);
      totalInterest += interest;
      totalPrincipal += principalPaid;
      totalDebtService += debtService;
    }

    const entry = {
      year,
      startingBalance,
      interest,
      principalPaid,
      debtService,
      endingBalance: balance,
    };
    schedule.push(entry);
    byYear[year] = entry;
  }

  return {
    annualDebtService,
    schedule,
    byYear,
    totalInterest,
    totalPrincipal,
    totalDebtService,
    endingBalance: balance,
  };
}

export function approximateIRR(cashFlows, preferredRate = 0.1) {
  if (!Array.isArray(cashFlows) || cashFlows.length < 2 || cashFlows[0] >= 0) return NaN;
  if (!cashFlows.slice(1).some(value => value > 0)) return NaN;

  const npvAt = rate => {
    let npv = 0;
    for (let year = 0; year < cashFlows.length; year++) {
      npv += cashFlows[year] / Math.pow(1 + rate, year);
    }
    return npv;
  };

  const solveBracket = (lo, hi, npvLo = npvAt(lo), npvHi = npvAt(hi)) => {
    if (!Number.isFinite(npvLo) || !Number.isFinite(npvHi)) return NaN;
    if (npvLo === 0) return lo;
    if (npvHi === 0) return hi;
    if (npvLo * npvHi > 0) return NaN;

    let low = lo;
    let high = hi;
    let lowNpv = npvLo;

    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2;
      const npvMid = npvAt(mid);
      if (npvMid === 0) return mid;
      if (lowNpv * npvMid > 0) {
        low = mid;
        lowNpv = npvMid;
      } else {
        high = mid;
      }
    }

    return (low + high) / 2;
  };

  const minRate = -0.99;
  const maxRate = 100;
  const safePreferredRate = Number.isFinite(preferredRate)
    ? Math.max(minRate, Math.min(maxRate, preferredRate))
    : 0.1;
  const scanRates = [minRate, safePreferredRate];
  const pushRange = (start, end, step) => {
    for (let rate = start; rate <= (end + (step / 2)); rate += step) {
      scanRates.push(Number(rate.toFixed(12)));
    }
  };

  pushRange(-0.98, 1, 0.01);
  pushRange(1.05, 5, 0.05);
  pushRange(5.25, 20, 0.25);
  pushRange(21, maxRate, 1);

  const sortedRates = [...new Set(scanRates.map(rate => Number(rate.toFixed(12))))]
    .sort((a, b) => a - b);
  const rootCandidates = [];
  let previousRate = sortedRates[0];
  let previousNpv = npvAt(previousRate);

  if (previousNpv === 0) {
    rootCandidates.push(previousRate);
  }

  for (let i = 1; i < sortedRates.length; i++) {
    const rate = sortedRates[i];
    const npv = npvAt(rate);

    if (!Number.isFinite(previousNpv) || !Number.isFinite(npv)) {
      previousRate = rate;
      previousNpv = npv;
      continue;
    }

    if (npv === 0) {
      rootCandidates.push(rate);
    } else if ((previousNpv > 0) !== (npv > 0)) {
      const root = solveBracket(previousRate, rate, previousNpv, npv);
      if (Number.isFinite(root)) {
        rootCandidates.push(root);
      }
    }

    previousRate = rate;
    previousNpv = npv;
  }

  if (!rootCandidates.length) return NaN;

  const uniqueRoots = rootCandidates
    .filter(root => Number.isFinite(root))
    .sort((a, b) => a - b)
    .filter((root, index, roots) => index === 0 || Math.abs(root - roots[index - 1]) > 1e-9);
  const positiveRoots = uniqueRoots.filter(root => root > 1e-9);
  // Multiple IRRs are ambiguous. Prefer the largest positive root so nearby
  // financing inputs stay on one stable economic branch instead of hopping
  // between smaller and larger positive solutions around the hurdle rate.
  if (positiveRoots.length) {
    return positiveRoots[positiveRoots.length - 1] * 100;
  }

  // If every real root is non-positive, keep the least-negative one.
  return uniqueRoots[uniqueRoots.length - 1] * 100;
}

export function buildFinancingModel(state, totalCapex) {
  const enabled = Boolean(state.financingEnabled);
  const debtSharePercent = enabled ? Math.max(0, Math.min(90, state.debtSharePercent || 0)) : 0;
  const debtInterestRate = enabled ? Math.max(0, state.debtInterestRate || 0) : 0;
  const debtTermYears = enabled
    ? Math.max(1, Math.min(Math.round(state.analysisHorizonYears || 1), Math.round(state.debtTermYears || 1)))
    : 0;
  const upfrontFeePercent = enabled ? Math.max(0, state.debtFeePercent || 0) : 0;
  const debtAmount = totalCapex * (debtSharePercent / 100);
  const equityCapex = Math.max(0, totalCapex - debtAmount);
  const upfrontFee = debtAmount * (upfrontFeePercent / 100);
  const debtSchedule = buildDebtSchedule(
    debtAmount,
    debtInterestRate / 100,
    debtTermYears,
    state.analysisHorizonYears
  );

  return {
    enabled,
    debtSharePercent,
    debtInterestRate,
    debtTermYears,
    upfrontFeePercent,
    debtAmount,
    equityCapex,
    upfrontFee,
    equityUpfront: equityCapex + upfrontFee,
    annualDebtService: debtSchedule.annualDebtService,
    totalInterest: debtSchedule.totalInterest,
    totalPrincipal: debtSchedule.totalPrincipal,
    totalDebtService: debtSchedule.totalDebtService,
    byYear: debtSchedule.byYear,
    schedule: debtSchedule.schedule,
  };
}

export function buildCashFlowTimeline(totalCapex, financing, yearlyCashFlows, policy = {}) {
  const financed = Boolean(financing?.enabled);
  const safeTotalCapex = Math.max(0, Number(totalCapex) || 0);
  const safeUpfrontPolicySupport = Math.max(0, Number(policy?.upfrontSupport) || 0);
  const safeNetCapexAtClose = Math.max(0, safeTotalCapex - safeUpfrontPolicySupport);
  const safeEquityUpfront = financed
    ? Math.max(0, Number(financing?.equityUpfront) || 0)
    : safeNetCapexAtClose;
  const safeDebtAmount = financed
    ? Math.max(0, Number(financing?.debtAmount) || 0)
    : 0;
  const labels = ['Close'];
  const annualRevenue = [safeUpfrontPolicySupport];
  const annualMarketRevenue = [0];
  const annualPolicyCredits = [safeUpfrontPolicySupport];
  const annualOperatingCost = [0];
  const replacementCapex = [0];
  const annualDebtService = [0];
  const projectCashFlow = [-safeNetCapexAtClose];
  const equityCashFlow = [-safeEquityUpfront];
  const cumulativeProjectCash = [-safeNetCapexAtClose];
  const cumulativeEquityCash = [-safeEquityUpfront];
  const sponsorSupportNeeded = [0];
  const debtStartingBalance = [safeDebtAmount];
  const debtEndingBalance = [safeDebtAmount];

  (Array.isArray(yearlyCashFlows) ? yearlyCashFlows : []).forEach(entry => {
    const revenue = Number.isFinite(entry?.totalRevenue) ? entry.totalRevenue : 0;
    const policyCredits = Number.isFinite(entry?.revenue?.policyCredits) ? entry.revenue.policyCredits : 0;
    const marketRevenue = revenue - policyCredits;
    const operatingCash = Number.isFinite(entry?.operatingCashFlow) ? entry.operatingCashFlow : 0;
    const operatingCost = Math.max(0, revenue - operatingCash);
    const replacements = Math.max(0, Number(entry?.replacementOutflow) || 0);
    const debtService = financed ? Math.max(0, Number(entry?.debtService) || 0) : 0;
    const projectCash = Number.isFinite(entry?.netCashFlow) ? entry.netCashFlow : 0;
    const equityCash = financed
      ? (Number.isFinite(entry?.equityCashFlow) ? entry.equityCashFlow : projectCash)
      : projectCash;
    const cumulativeProject = Number.isFinite(entry?.cumulativeNetCash)
      ? entry.cumulativeNetCash
      : (cumulativeProjectCash[cumulativeProjectCash.length - 1] + projectCash);
    const cumulativeEquity = financed
      ? (Number.isFinite(entry?.cumulativeEquityCash)
          ? entry.cumulativeEquityCash
          : (cumulativeEquityCash[cumulativeEquityCash.length - 1] + equityCash))
      : cumulativeProject;

    labels.push(`Year ${entry?.year ?? labels.length}`);
    annualRevenue.push(revenue);
    annualMarketRevenue.push(marketRevenue);
    annualPolicyCredits.push(policyCredits);
    annualOperatingCost.push(operatingCost);
    replacementCapex.push(replacements);
    annualDebtService.push(debtService);
    projectCashFlow.push(projectCash);
    equityCashFlow.push(equityCash);
    cumulativeProjectCash.push(cumulativeProject);
    cumulativeEquityCash.push(cumulativeEquity);
    sponsorSupportNeeded.push(financed ? Math.max(0, Number(entry?.sponsorSupportNeeded) || 0) : 0);
    debtStartingBalance.push(financed ? Math.max(0, Number(entry?.debtStartingBalance) || 0) : 0);
    debtEndingBalance.push(financed ? Math.max(0, Number(entry?.debtEndingBalance) || 0) : 0);
  });

  return {
    labels,
    annualRevenue,
    annualMarketRevenue,
    annualPolicyCredits,
    annualOperatingCost,
    replacementCapex,
    annualDebtService,
    projectCashFlow,
    equityCashFlow,
    cumulativeProjectCash,
    cumulativeEquityCash,
    sponsorSupportNeeded,
    debtStartingBalance,
    debtEndingBalance,
    financed,
    hasDebtService: financed && annualDebtService.some(value => value > 1e-9),
    hasPolicyCredits: annualPolicyCredits.some(value => Math.abs(value) > 1e-9),
    hasReplacements: replacementCapex.some(value => value > 1e-9),
    hasSponsorSupport: financed && sponsorSupportNeeded.some(value => value > 1e-9),
    totalCapex: safeTotalCapex,
    netCapexAtClose: safeNetCapexAtClose,
    upfrontPolicySupport: safeUpfrontPolicySupport,
    debtAmount: safeDebtAmount,
    equityUpfront: safeEquityUpfront,
  };
}

export const financeMethods = {
  crf,
  getSolarDegradationFactor,
  getSolarFactorForYear,
  getAverageSolarDegradationFactor,
  getPolicyDurationFactor,
  buildReplacementSchedule,
  calculateSimplePaybackYears,
  calculateSustainedPaybackYears,
  buildDebtSchedule,
  approximateIRR,
  buildFinancingModel,
  buildCashFlowTimeline,
};
