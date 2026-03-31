/* Core finance and shared helpers for Calc */

const Calc = {};

Object.assign(Calc, {
  hasBatteryStorage(state) {
    const batteryCapacityMWh = Number(state?.batteryCapacityMWh);
    return Number.isFinite(batteryCapacityMWh) && batteryCapacityMWh > 1e-9;
  },

  getAiBatteryHeuristicMWh(state) {
    if (!state?.aiComputeEnabled || this.hasBatteryStorage(state)) return 0;
    const annualSolarMWh = this.calculateSolar(state).annualMWh || 0;
    return this.clampNumber(annualSolarMWh / 1000, 0, 1e9, 0);
  },

  toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  },

  clampNumber(value, min, max, fallback = min) {
    const numeric = this.toFiniteNumber(value, fallback);
    return Math.min(max, Math.max(min, numeric));
  },

  clampInteger(value, min, max, fallback = min) {
    return Math.round(this.clampNumber(value, min, max, fallback));
  },

  normalizeState(rawState = {}) {
    const input = rawState && typeof rawState === 'object' ? rawState : {};
    const normalized = {
      ...DEFAULT_STATE,
      ...input,
    };
    const enumOrDefault = (value, allowed, fallback) => (allowed.has(value) ? value : fallback);
    const solarProfileDefaults = {
      earth: 'earth',
      mars: 'mars-average',
      moon: 'lunar-pel',
    };
    const solarProfileOptions = {
      earth: new Set(['earth']),
      mars: new Set(['mars', 'mars-average']),
      moon: new Set(['moon', 'lunar-pel']),
    };

    normalized.loadConfigTab = enumOrDefault(input.loadConfigTab, new Set(['chemicals', 'ai']), DEFAULT_STATE.loadConfigTab);
    normalized.dayMode = enumOrDefault(input.dayMode, new Set(['average', 'specific']), DEFAULT_STATE.dayMode);
    normalized.body = enumOrDefault(input.body, new Set(Object.keys(PLANETARY_BODIES)), DEFAULT_STATE.body);
    normalized.mountingType = enumOrDefault(input.mountingType, new Set(Object.keys(MOUNTING_TYPES)), DEFAULT_STATE.mountingType);
    normalized.siteYieldSource = enumOrDefault(
      input.siteYieldSource,
      new Set(['preset', 'manual', 'estimated', 'planetary-custom']),
      DEFAULT_STATE.siteYieldSource
    );
    normalized.policyMode = enumOrDefault(input.policyMode, new Set(Object.keys(POLICY_OPTIONS)), DEFAULT_STATE.policyMode);
    normalized.methaneMarketPreset = enumOrDefault(
      input.methaneMarketPreset,
      new Set(Object.keys(METHANE_MARKET_PRESETS)),
      DEFAULT_STATE.methaneMarketPreset
    );

    const solarProfileFallback = solarProfileDefaults[normalized.body] || DEFAULT_STATE.solarProfileModel;
    const allowedProfiles = solarProfileOptions[normalized.body] || new Set([solarProfileFallback]);
    normalized.solarProfileModel = allowedProfiles.has(input.solarProfileModel)
      ? input.solarProfileModel
      : solarProfileFallback;

    normalized.latitude = this.clampNumber(input.latitude, -90, 90, DEFAULT_STATE.latitude);
    normalized.longitude = this.clampNumber(input.longitude, -180, 180, DEFAULT_STATE.longitude);
    normalized.dayOfYear = this.clampInteger(input.dayOfYear, 1, 365, DEFAULT_STATE.dayOfYear);
    normalized.siteYieldMwhPerMwdcYear = this.clampNumber(
      input.siteYieldMwhPerMwdcYear,
      0,
      1e6,
      DEFAULT_STATE.siteYieldMwhPerMwdcYear
    );
    normalized.systemSizeMW = this.clampNumber(input.systemSizeMW, 0, 1e6, DEFAULT_STATE.systemSizeMW);
    normalized.panelEfficiency = this.clampNumber(input.panelEfficiency, 1, 100, DEFAULT_STATE.panelEfficiency);
    normalized.panelCostPerW = this.clampNumber(input.panelCostPerW, 0, 1e6, DEFAULT_STATE.panelCostPerW);
    normalized.panelDegradationAnnual = this.clampNumber(
      input.panelDegradationAnnual,
      0,
      100,
      DEFAULT_STATE.panelDegradationAnnual
    );
    normalized.bosCostPerW = this.clampNumber(input.bosCostPerW, 0, 1e6, DEFAULT_STATE.bosCostPerW);
    normalized.landCostPerAcre = this.clampNumber(input.landCostPerAcre, 0, 1e9, DEFAULT_STATE.landCostPerAcre);
    normalized.sitePrepCostPerAcre = this.clampNumber(
      input.sitePrepCostPerAcre,
      0,
      1e9,
      DEFAULT_STATE.sitePrepCostPerAcre
    );

    normalized.batteryCapacityMWh = this.clampNumber(
      input.batteryCapacityMWh,
      0,
      1e9,
      DEFAULT_STATE.batteryCapacityMWh
    );
    normalized.batteryCostPerKWh = this.clampNumber(
      input.batteryCostPerKWh,
      0,
      1e6,
      DEFAULT_STATE.batteryCostPerKWh
    );
    normalized.batteryEfficiency = this.clampNumber(input.batteryEfficiency, 0, 100, DEFAULT_STATE.batteryEfficiency);
    normalized.batteryCycles = this.clampNumber(input.batteryCycles, 1, 1e9, DEFAULT_STATE.batteryCycles);

    normalized.aiReliabilityTarget = this.clampNumber(
      input.aiReliabilityTarget,
      0,
      99.9999,
      DEFAULT_STATE.aiReliabilityTarget
    );
    normalized.aiTokenPricePerM = this.clampNumber(input.aiTokenPricePerM, 0, 1e9, DEFAULT_STATE.aiTokenPricePerM);
    normalized.aiMillionTokensPerMWh = this.clampNumber(
      input.aiMillionTokensPerMWh,
      0,
      1e9,
      DEFAULT_STATE.aiMillionTokensPerMWh
    );
    normalized.aiGpuCapexPerKW = this.clampNumber(input.aiGpuCapexPerKW, 0, 1e9, DEFAULT_STATE.aiGpuCapexPerKW);
    normalized.aiAssetLifeYears = this.clampInteger(input.aiAssetLifeYears, 1, 100, DEFAULT_STATE.aiAssetLifeYears);

    normalized.methaneFeedstockSplit = this.clampNumber(
      input.methaneFeedstockSplit,
      0,
      100,
      DEFAULT_STATE.methaneFeedstockSplit
    );
    normalized.methanePrice = this.clampNumber(input.methanePrice, 0, 1e9, DEFAULT_STATE.methanePrice);
    normalized.methanolPrice = this.clampNumber(input.methanolPrice, 0, 1e9, DEFAULT_STATE.methanolPrice);
    normalized.customH2Credit = this.clampNumber(input.customH2Credit, 0, 1e6, DEFAULT_STATE.customH2Credit);
    normalized.customCo2Credit = this.clampNumber(input.customCo2Credit, 0, 1e6, DEFAULT_STATE.customCo2Credit);

    normalized.solarAssetLife = this.clampInteger(input.solarAssetLife, 1, 100, DEFAULT_STATE.solarAssetLife);
    normalized.analysisHorizonYears = this.clampInteger(
      input.analysisHorizonYears,
      1,
      100,
      DEFAULT_STATE.analysisHorizonYears
    );
    normalized.discountRate = this.clampNumber(input.discountRate, 0, 1000, DEFAULT_STATE.discountRate);
    normalized.debtSharePercent = this.clampNumber(input.debtSharePercent, 0, 90, DEFAULT_STATE.debtSharePercent);
    normalized.debtInterestRate = this.clampNumber(
      input.debtInterestRate,
      0,
      1000,
      DEFAULT_STATE.debtInterestRate
    );
    normalized.debtTermYears = this.clampInteger(
      input.debtTermYears,
      1,
      normalized.analysisHorizonYears,
      DEFAULT_STATE.debtTermYears
    );
    normalized.debtFeePercent = this.clampNumber(input.debtFeePercent, 0, 100, DEFAULT_STATE.debtFeePercent);
    normalized.solarOmPercent = this.clampNumber(input.solarOmPercent, 0, 100, DEFAULT_STATE.solarOmPercent);
    normalized.processOmPercent = this.clampNumber(input.processOmPercent, 0, 100, DEFAULT_STATE.processOmPercent);
    normalized.batteryOmPercent = this.clampNumber(input.batteryOmPercent, 0, 100, DEFAULT_STATE.batteryOmPercent);

    [
      'batteryEnabled',
      'aiComputeEnabled',
      'electrolyzerEnabled',
      'dacEnabled',
      'sabatierEnabled',
      'methanolEnabled',
      'carbonMonoxideEnabled',
      'ammoniaEnabled',
      'cokeEnabled',
      'cementEnabled',
      'steelEnabled',
      'siliconEnabled',
      'aluminumEnabled',
      'titaniumEnabled',
      'desalinationEnabled',
      'financingEnabled',
    ].forEach(key => {
      normalized[key] = Boolean(normalized[key]);
    });

    if (normalized.aiComputeEnabled && normalized.batteryCapacityMWh <= 1e-9) {
      // Seed AI mode with a simple default: 1 MWh of storage per 1 GWh/year of solar.
      normalized.batteryCapacityMWh = this.getAiBatteryHeuristicMWh(normalized);
    }

    MODULE_REGISTRY.forEach(module => {
      (module.configs || []).forEach(config => {
        normalized[config.key] = this.clampNumber(
          input[config.key],
          config.min,
          config.max,
          DEFAULT_STATE[config.key]
        );
      });

      if (module.assetLifeKey) {
        normalized[module.assetLifeKey] = this.clampInteger(
          input[module.assetLifeKey],
          1,
          100,
          DEFAULT_STATE[module.assetLifeKey]
        );
      }

      if (module.routeOptions?.length) {
        const fallbackRoute = module.routeOptions[0].value;
        const routeOptions = new Set(module.routeOptions.map(option => option.value));
        normalized[`${module.id}Route`] = enumOrDefault(
          input[`${module.id}Route`],
          routeOptions,
          DEFAULT_STATE[`${module.id}Route`] || fallbackRoute
        );
      }
    });

    const bodyConfig = PLANETARY_BODIES[normalized.body] || PLANETARY_BODIES.earth;
    if (!bodyConfig.supportsSpecificDay) {
      normalized.dayMode = 'average';
    }

    normalized.batteryEnabled = this.hasBatteryStorage(normalized);

    return normalized;
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

  calculateSimplePaybackYears(initialOutflow, yearlyCashFlows) {
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
  },

  calculateSustainedPaybackYears(initialOutflow, yearlyCashFlows) {
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

  calculatePaybackYears(initialOutflow, yearlyCashFlows) {
    return this.calculateSimplePaybackYears(initialOutflow, yearlyCashFlows);
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
