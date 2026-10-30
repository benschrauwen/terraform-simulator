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

/* Discounted (levelized) degradation factor over `years`: the constant
   output with the same present value as the degrading output,
   sum f_y / (1 + r)^y x CRF(r, years). LCOE divides an annualized (CRF)
   cost, so the energy must be levelized the same way, not averaged. */
export function getLevelizedSolarDegradationFactor(degradationPercent, years, rate) {
  if (!Number.isFinite(years) || years <= 0) return 1;
  const safeRate = Number.isFinite(rate) ? rate : 0;
  let presentValue = 0;
  for (let year = 1; year <= years; year++) {
    presentValue += getSolarDegradationFactor(degradationPercent, year) / Math.pow(1 + safeRate, year);
  }
  return presentValue * crf(safeRate, years);
}

export function getPolicyDurationFactor(policy, year) {
  if (!policy || !Number.isFinite(policy.durationYears) || policy.durationYears <= 0) return 1;
  return year <= policy.durationYears ? 1 : 0;
}

/* Replacement outflows and end-of-horizon salvage for a list of assets
   { key, label, cost, replacementCost?, lifeYears, salvageAtCost? }.

   Replacements fall at multiples of the (possibly fractional) life that are
   strictly inside the horizon, each paid in the year it falls in
   (ceil: end-of-year cash-flow convention), so a 11.3-year battery is paid
   in years 12, 23, ... while the schedule itself does not drift. A
   replacement costs `replacementCost` (default: the initial cost).

   Salvage in the final year is straight-line: the last installation's cost x
   remaining life / life, measured from its scheduled (fractional) install
   time, so a 7-year asset replaced in year 28 of 30 returns 5/7 of its cost.
   Assets without a finite life (land) are never replaced and return their
   cost when `salvageAtCost` is set. */
export function buildReplacementSchedule(analysisHorizonYears, assets) {
  const byYear = {};
  const entries = [];
  const salvageItems = [];
  const horizon = Number.isFinite(analysisHorizonYears) ? Math.max(0, analysisHorizonYears) : 0;

  for (const asset of assets) {
    if (!asset || !Number.isFinite(asset.cost) || asset.cost <= 0) continue;
    if (!Number.isFinite(asset.lifeYears)) {
      if (asset.salvageAtCost && horizon > 0) {
        salvageItems.push({ key: asset.key, label: asset.label, cost: asset.cost, remainingYears: Infinity, value: asset.cost });
      }
      continue;
    }
    if (asset.lifeYears <= 0) continue;

    const replacementCost = Number.isFinite(asset.replacementCost) ? Math.max(0, asset.replacementCost) : asset.cost;
    let lastInstalledAt = 0;
    let lastCost = asset.cost;
    let replacementAt = asset.lifeYears;
    while (replacementAt < horizon - 1e-9) {
      const year = Math.max(1, Math.ceil(replacementAt - 1e-9));
      if (replacementCost > 0) {
        if (!byYear[year]) {
          byYear[year] = {
            year,
            total: 0,
            items: [],
          };
          entries.push(byYear[year]);
        }

        byYear[year].total += replacementCost;
        byYear[year].items.push({
          key: asset.key,
          label: asset.label,
          cost: replacementCost,
          lifeYears: asset.lifeYears,
          scheduledAtYear: replacementAt,
        });
      }

      lastInstalledAt = replacementAt;
      lastCost = replacementCost;
      replacementAt += asset.lifeYears;
    }

    const remainingYears = Math.max(0, asset.lifeYears - (horizon - lastInstalledAt));
    const value = lastCost * (remainingYears / asset.lifeYears);
    if (value > 1e-9 && horizon > 0) {
      salvageItems.push({ key: asset.key, label: asset.label, cost: lastCost, remainingYears, value });
    }
  }

  entries.sort((a, b) => a.year - b.year);

  return {
    byYear,
    entries,
    total: entries.reduce((sum, entry) => sum + entry.total, 0),
    salvage: {
      year: horizon,
      items: salvageItems,
      total: salvageItems.reduce((sum, item) => sum + item.value, 0),
    },
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

    let balloonPayment = 0;
    if (year <= safeTermYears && startingBalance > 1e-9) {
      interest = startingBalance * safeRate;
      principalPaid = Math.max(0, annualDebtService - interest);
      if (year === safeTermYears || principalPaid > startingBalance) {
        principalPaid = startingBalance;
      }
      // A term longer than the horizon keeps its level payment; the balance
      // still outstanding at the end of the horizon is repaid as a balloon.
      if (year === safeHorizonYears && safeTermYears > safeHorizonYears) {
        balloonPayment = Math.max(0, startingBalance - principalPaid);
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
      scheduledDebtService: debtService - balloonPayment,
      balloonPayment,
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
    balloonPayment: schedule.reduce((sum, entry) => sum + entry.balloonPayment, 0),
    endingBalance: balance,
  };
}

export function npvAtRate(cashFlows, rate) {
  let npv = 0;
  for (let year = 0; year < cashFlows.length; year++) {
    npv += cashFlows[year] / Math.pow(1 + rate, year);
  }
  return npv;
}

export const IRR_RATE_RANGE = Object.freeze({ min: -0.99, max: 100 });

/* Every rate in [-99%, +10000%] where the NPV of `cashFlows` crosses zero,
   as fractions, ascending: a scan on a 1%-5%-25%-100% grid with bisection
   inside each bracketing pair. */
export function findIrrRoots(cashFlows) {
  const npvAt = rate => npvAtRate(cashFlows, rate);

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

  const minRate = IRR_RATE_RANGE.min;
  const maxRate = IRR_RATE_RANGE.max;
  const scanRates = [minRate];
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

  return rootCandidates
    .filter(root => Number.isFinite(root))
    .sort((a, b) => a - b)
    .filter((root, index, roots) => index === 0 || Math.abs(root - roots[index - 1]) > 1e-9);
}

function countSignChanges(values) {
  let changes = 0;
  let previousSign = 0;
  values.forEach(value => {
    const sign = value > 0 ? 1 : value < 0 ? -1 : 0;
    if (sign === 0) return;
    if (previousSign !== 0 && sign !== previousSign) changes += 1;
    previousSign = sign;
  });
  return changes;
}

const formatRootPercent = root => `${(root * 100).toFixed(1)}%`;

/* IRR with an explicit verdict. The IRR is reported only when one
   economically meaningful root exists:
   - conventional cash flows (one sign change: investment, then returns)
     have exactly one root (Descartes), reported whatever its sign;
   - otherwise (replacements or debt service create later outflows), if
     undiscounted cash recovers the investment (NPV(0) >= 0) there is an odd
     number of positive roots: a single one is reported, negative roots are
     ignored as artefacts of the late outflows dominating at rates near -100%;
   - if undiscounted cash does not recover the investment, any root is
     negative and driven by the sign of the last flows, so none is reported.
   Several candidate roots make the IRR ambiguous; MIRR is the fallback.
   `irr` is in percent (NaN when not reported). */
export function analyzeIRR(cashFlows) {
  const result = (irr, status, label, reason, roots = []) => ({ irr, status, label, reason, roots });
  if (!Array.isArray(cashFlows) || cashFlows.length < 2 || !cashFlows.every(Number.isFinite)) {
    return result(NaN, 'invalid', 'n/a', 'No cash-flow series to evaluate.');
  }
  if (cashFlows[0] >= 0) {
    return result(NaN, 'no-investment', 'n/a (no net investment)',
      'There is no net upfront investment (incentives cover the initial CAPEX), so a rate of return on it is undefined. Judge the project by NPV.');
  }
  if (!cashFlows.slice(1).some(value => value > 0)) {
    return result(NaN, 'no-return', 'n/a (no cash returned)',
      'No year returns positive cash, so there is no rate of return.');
  }

  const roots = findIrrRoots(cashFlows);
  const signChanges = countSignChanges(cashFlows);
  if (signChanges === 1) {
    return roots.length
      ? result(roots[0] * 100, 'ok', '', 'Conventional cash flows: one sign change, so the IRR is unique.', roots)
      : result(NaN, 'no-root', 'n/a', 'NPV does not cross zero between -99% and +10,000%.', roots);
  }

  const undiscountedNet = cashFlows.reduce((sum, value) => sum + value, 0);
  if (undiscountedNet >= 0) {
    const positiveRoots = roots.filter(root => root >= -1e-12);
    if (positiveRoots.length === 1) {
      return result(positiveRoots[0] * 100, 'ok', '',
        'Later outflows (replacements or debt service) make the cash flows non-conventional, but only one non-negative rate zeroes NPV.', roots);
    }
    if (positiveRoots.length > 1) {
      return result(NaN, 'ambiguous', 'ambiguous (see MIRR)',
        `NPV crosses zero at several rates (${positiveRoots.map(formatRootPercent).join(', ')}), so there is no single IRR. MIRR is the unambiguous rate.`, roots);
    }
    return result(NaN, 'no-root', 'n/a (see MIRR)', 'NPV does not cross zero at any non-negative rate.', roots);
  }

  if (roots.length > 1) {
    return result(NaN, 'ambiguous', 'ambiguous (see MIRR)',
      `NPV crosses zero at several rates (${roots.map(formatRootPercent).join(', ')}), so there is no single IRR. MIRR is the unambiguous rate.`, roots);
  }
  return result(NaN, 'no-meaningful-root', 'n/a (see MIRR)',
    roots.length
      ? `Undiscounted cash never recovers the investment and later outflows make the cash flows non-conventional; the only NPV root (${formatRootPercent(roots[0])}) is an artefact of the final years' sign, not a rate of return. MIRR is shown instead.`
      : 'Undiscounted cash never recovers the investment, so there is no meaningful IRR. MIRR is shown instead.',
    roots);
}

/* IRR in percent, NaN when analyzeIRR finds no single meaningful root. */
export function approximateIRR(cashFlows) {
  return analyzeIRR(cashFlows).irr;
}

/* Modified IRR (percent): outflows discounted to year 0 at `financeRate`,
   inflows compounded to the final year at `reinvestRate`:
   MIRR = (FV(inflows) / -PV(outflows))^(1/n) - 1. Unique by construction;
   NaN when there is no outflow or no inflow. */
export function calculateMIRR(cashFlows, financeRate, reinvestRate = financeRate) {
  if (!Array.isArray(cashFlows) || cashFlows.length < 2) return NaN;
  const n = cashFlows.length - 1;
  let presentOutflows = 0;
  let futureInflows = 0;
  cashFlows.forEach((value, year) => {
    if (!Number.isFinite(value)) return;
    if (value < 0) presentOutflows += value / Math.pow(1 + financeRate, year);
    else futureInflows += value * Math.pow(1 + reinvestRate, n - year);
  });
  if (!(presentOutflows < 0) || !(futureInflows > 0)) return NaN;
  return (Math.pow(futureInflows / -presentOutflows, 1 / n) - 1) * 100;
}

export function buildFinancingModel(state, totalCapex) {
  const enabled = Boolean(state.financingEnabled);
  const debtSharePercent = enabled ? Math.max(0, Math.min(90, state.debtSharePercent || 0)) : 0;
  const debtInterestRate = enabled ? Math.max(0, state.debtInterestRate || 0) : 0;
  // The term is not clamped to the horizon: a longer loan amortizes on its
  // own schedule and the outstanding balance is repaid at the horizon.
  const debtTermYears = enabled ? Math.max(1, Math.round(state.debtTermYears || 1)) : 0;
  const horizonYears = Math.max(1, Math.round(state.analysisHorizonYears || 1));
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
    termExceedsHorizon: enabled && debtTermYears > horizonYears,
    balloonPayment: debtSchedule.balloonPayment,
    balloonYear: debtSchedule.balloonPayment > 1e-9 ? horizonYears : null,
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
  const salvageValue = [0];
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
    const salvage = Math.max(0, Number(entry?.salvageValue) || 0);
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
    salvageValue.push(salvage);
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
    salvageValue,
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
    hasSalvage: salvageValue.some(value => value > 1e-9),
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
  getLevelizedSolarDegradationFactor,
  getPolicyDurationFactor,
  buildReplacementSchedule,
  calculateSimplePaybackYears,
  calculateSustainedPaybackYears,
  buildDebtSchedule,
  npvAtRate,
  findIrrRoots,
  analyzeIRR,
  approximateIRR,
  calculateMIRR,
  buildFinancingModel,
  buildCashFlowTimeline,
};
