/* Core finance and shared helpers for Calc */

const Calc = {};

Object.assign(Calc, {
  hasBatteryStorage(state) {
    const batteryCapacityMWh = Number(state?.batteryCapacityMWh);
    return Number.isFinite(batteryCapacityMWh) && batteryCapacityMWh > 1e-9;
  },

  crf(rate, years) {
    if (!isFinite(rate) || !isFinite(years) || years <= 0) return 0;
    if (rate === 0) return 1 / years;
    return (rate * Math.pow(1 + rate, years)) / (Math.pow(1 + rate, years) - 1);
  },

  getBatteryLeakageRetention(stepHours) {
    const monthlyLeakage = Math.max(0, Math.min(0.999999, MODEL_ASSUMPTIONS.batteryMonthlyLeakage || 0));
    if (!Number.isFinite(stepHours) || stepHours <= 0 || monthlyLeakage <= 0) return 1;
    const averageMonthHours = (365 * 24) / 12;
    return Math.pow(1 - monthlyLeakage, stepHours / averageMonthHours);
  },

  scaleCapex(referenceCapex, actualThroughput, referenceThroughput, exponent = 0.75) {
    if (!referenceCapex || !actualThroughput || !referenceThroughput) return 0;
    const normalized = Math.max(0.25, actualThroughput / referenceThroughput);
    return referenceCapex * Math.pow(normalized, exponent);
  },

  getSolarDegradationFactor(degradationPercent, year) {
    if (!Number.isFinite(year) || year <= 1) return 1;
    const annualRetention = Math.max(0, 1 - (Math.max(0, degradationPercent || 0) / 100));
    return Math.pow(annualRetention, year - 1);
  },

  getAverageSolarDegradationFactor(degradationPercent, years) {
    if (!Number.isFinite(years) || years <= 0) return 1;
    let totalFactor = 0;
    for (let year = 1; year <= years; year++) {
      totalFactor += this.getSolarDegradationFactor(degradationPercent, year);
    }
    return totalFactor / years;
  },

  getPolicyDurationFactor(policy, year) {
    if (!policy || !Number.isFinite(policy.durationYears) || policy.durationYears <= 0) return 1;
    return year <= policy.durationYears ? 1 : 0;
  },

  buildReplacementSchedule(analysisHorizonYears, assets) {
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
  },

  calculatePaybackYears(initialOutflow, yearlyCashFlows) {
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
  },

  buildDebtSchedule(principal, annualRate, termYears, analysisHorizonYears) {
    const safePrincipal = Number.isFinite(principal) ? Math.max(0, principal) : 0;
    const safeRate = Number.isFinite(annualRate) ? Math.max(0, annualRate) : 0;
    const safeTermYears = Number.isFinite(termYears) ? Math.max(0, Math.round(termYears)) : 0;
    const safeHorizonYears = Number.isFinite(analysisHorizonYears) ? Math.max(0, Math.round(analysisHorizonYears)) : 0;
    const annualDebtService = (safePrincipal > 0 && safeTermYears > 0)
      ? (safeRate === 0 ? safePrincipal / safeTermYears : safePrincipal * this.crf(safeRate, safeTermYears))
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
  },

  approximateIRR(cashFlows) {
    if (!Array.isArray(cashFlows) || cashFlows.length < 2 || cashFlows[0] >= 0) return NaN;
    if (!cashFlows.slice(1).some(value => value > 0)) return NaN;

    const npvAt = rate => {
      let npv = 0;
      for (let year = 0; year < cashFlows.length; year++) {
        npv += cashFlows[year] / Math.pow(1 + rate, year);
      }
      return npv;
    };

    let lo = -0.99;
    let hi = 0.25;
    let npvLo = npvAt(lo);
    let npvHi = npvAt(hi);

    while (npvLo * npvHi > 0 && hi < 100) {
      hi = hi < 1 ? (hi * 2) + 0.25 : hi * 2;
      npvHi = npvAt(hi);
    }

    if (!Number.isFinite(npvLo) || !Number.isFinite(npvHi) || npvLo * npvHi > 0) {
      return NaN;
    }

    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const npvMid = npvAt(mid);
      if (npvMid === 0) return mid * 100;
      if (npvLo * npvMid > 0) {
        lo = mid;
        npvLo = npvMid;
      } else {
        hi = mid;
        npvHi = npvMid;
      }
    }

    return ((lo + hi) / 2) * 100;
  },
});
