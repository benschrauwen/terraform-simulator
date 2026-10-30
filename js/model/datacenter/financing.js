/* ============================================
   Datacenter project financing
   ============================================
   Two kinds of debt, on the economics' annual end-of-year grid (year 0 =
   notice-to-proceed / close, t0 = first power in years):

   1. Construction loan -> term loan. debtSharePercent of every non-GPU
      capex payment (land, building, cooling, substation, grid, generation,
      solar, battery) is drawn as it is paid: with the construction capex
      spread over the build that follows its payment schedule, with 'ntp'
      timing it is all drawn at close. Interest during construction is
      capitalized into the balance (the usual project-finance treatment: no
      cash to pay it before first power) until conversion, the year-end
      K = max(ceil(t0), the last draw); from K + 1 the balance amortizes
      over debtTermYears with level payments at debtInterestRate.
   2. GPU debt. Each GPU purchase (the first fleet at first power or at
      close, then every refresh) is financed at gpuDebtSharePercent of its
      cost at gpuDebtInterestRate, drawn with the purchase and amortized
      with level payments over the GPU life from the year after it (and
      never before first power, interest capitalized until then).

   Every tranche pays an upfront fee (debtFeePercent of what it draws) in
   its first draw year, and is repaid in full at the horizon (balloon) if a
   balance remains. Equity cash flow = project cash flow + draws - debt
   service - fees; year 0's is the sponsor cash at close. Pure; no DOM. */

/** Level annual payment that repays `principal` over `years` at `rate`. */
export function levelPayment(principal, rate, years) {
  if (!(principal > 0) || !(years > 0)) return 0;
  return rate > 0 ? principal * rate / (1 - Math.pow(1 + rate, -years)) : principal / years;
}

/**
 * One tranche on the annual grid: draws { [year]: amount } -> per-year
 * { draw, capitalizedInterest, interest, principal, balloon, service,
 * startBalance, endBalance, fee } and its totals.
 */
export function buildTranche({ draws, rate, termYears, conversionYear, horizonYears, feeRate = 0 }) {
  const years = Object.keys(draws).map(Number).filter(year => draws[year] > 0);
  const byYear = {};
  const drawn = years.reduce((sum, year) => sum + draws[year], 0);
  if (!years.length) return { byYear, drawn: 0, fee: 0, balanceAtConversion: 0, capitalizedInterest: 0, annualPayment: 0, totalInterest: 0, balloon: 0 };
  const firstDraw = Math.min(...years);
  const conversion = Math.max(conversionYear, Math.max(...years));
  const fee = drawn * feeRate;
  let balance = 0;
  let payment = 0;
  let paymentsLeft = termYears;
  let capitalizedInterest = 0;
  let totalInterest = 0;
  let balloon = 0;
  let balanceAtConversion = 0;
  for (let year = firstDraw; year <= horizonYears; year++) {
    const startBalance = balance;
    const entry = { draw: draws[year] || 0, capitalizedInterest: 0, interest: 0, principal: 0, balloon: 0, service: 0, startBalance, endBalance: 0, fee: year === firstDraw ? fee : 0 };
    const interest = balance * rate;
    if (year <= conversion) {
      // Construction: interest added to the balance, draws on top.
      entry.capitalizedInterest = year > firstDraw ? interest : 0;
      balance += entry.capitalizedInterest + entry.draw;
      capitalizedInterest += entry.capitalizedInterest;
      if (year === conversion) {
        balanceAtConversion = balance;
        payment = levelPayment(balance, rate, termYears);
      }
    } else if (balance > 1e-9) {
      entry.interest = interest;
      const principal = paymentsLeft > 1 ? Math.min(balance, payment - interest) : balance;
      entry.principal = principal;
      balance -= principal;
      paymentsLeft -= 1;
      totalInterest += interest;
    }
    if (year === horizonYears && balance > 1e-9) {
      entry.balloon = balance;
      balloon = balance;
      balance = 0;
    }
    entry.service = entry.interest + entry.principal + entry.balloon;
    entry.endBalance = balance;
    byYear[year] = entry;
  }
  return { byYear, drawn, fee, balanceAtConversion, capitalizedInterest, annualPayment: payment, totalInterest, balloon, firstDraw, conversionYear: conversion };
}

const FIELDS = ['draw', 'capitalizedInterest', 'interest', 'principal', 'balloon', 'service', 'startBalance', 'endBalance', 'fee'];

/**
 * The financing of a datacenter design. `constructionByYear`: non-GPU capex
 * paid per year-end; `gpuCohorts`: [{ atYears, byYear: { [year]: amount } }]
 * per GPU purchase; t0: first power (years). Returns { enabled, settings,
 * construction (tranche), gpu (tranches per cohort), byYear (totals per
 * year: FIELDS), drawn, fees, equityUpfront (sponsor cash at close: capex
 * at close - draws at close + fees at close), ... }.
 */
export function buildDatacenterFinancing(state, { constructionByYear, gpuCohorts, t0, horizonYears, gpuLifeYears }) {
  const enabled = Boolean(state.financingEnabled);
  const settings = {
    debtSharePercent: enabled ? Math.max(0, Math.min(90, state.debtSharePercent || 0)) : 0,
    debtInterestRate: enabled ? Math.max(0, state.debtInterestRate || 0) : 0,
    debtTermYears: enabled ? Math.max(1, Math.round(state.debtTermYears || 1)) : 0,
    upfrontFeePercent: enabled ? Math.max(0, state.debtFeePercent || 0) : 0,
    gpuDebtSharePercent: enabled ? Math.max(0, Math.min(90, state.gpuDebtSharePercent || 0)) : 0,
    gpuDebtInterestRate: enabled ? Math.max(0, state.gpuDebtInterestRate || 0) : 0,
    gpuDebtTermYears: Math.max(1, Math.round(gpuLifeYears || 1)),
  };
  const firstPowerYear = Math.ceil(t0 - 1e-9);
  const feeRate = settings.upfrontFeePercent / 100;
  const scale = (byYear, share) => Object.fromEntries(Object.entries(byYear).map(([year, amount]) => [year, amount * share]));
  const construction = buildTranche({
    draws: scale(constructionByYear, settings.debtSharePercent / 100),
    rate: settings.debtInterestRate / 100,
    termYears: settings.debtTermYears,
    conversionYear: firstPowerYear,
    horizonYears,
    feeRate,
  });
  const gpu = gpuCohorts.map(cohort => ({
    atYears: cohort.atYears,
    ...buildTranche({
      draws: scale(cohort.byYear, settings.gpuDebtSharePercent / 100),
      rate: settings.gpuDebtInterestRate / 100,
      termYears: settings.gpuDebtTermYears,
      conversionYear: firstPowerYear,
      horizonYears,
      feeRate,
    }),
  })).filter(tranche => tranche.drawn > 0);
  const byYear = {};
  [construction, ...gpu].forEach(tranche => Object.entries(tranche.byYear).forEach(([year, entry]) => {
    const total = byYear[year] || (byYear[year] = Object.fromEntries(FIELDS.map(field => [field, 0])));
    FIELDS.forEach(field => { total[field] += entry[field]; });
  }));
  const sum = field => Object.values(byYear).reduce((total, entry) => total + entry[field], 0);
  const atClose = byYear[0] || { draw: 0, fee: 0 };
  return {
    enabled,
    ...settings,
    construction,
    gpu,
    byYear,
    drawn: construction.drawn + gpu.reduce((total, tranche) => total + tranche.drawn, 0),
    fees: sum('fee'),
    drawsAtClose: atClose.draw,
    feesAtClose: atClose.fee,
    totalInterest: sum('interest'),
    totalCapitalizedInterest: sum('capitalizedInterest'),
    totalPrincipal: sum('principal'),
    totalDebtService: sum('service'),
    balloonPayment: sum('balloon'),
    balloonYear: sum('balloon') > 1e-9 ? horizonYears : null,
  };
}
