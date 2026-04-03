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

  getChemicalSizingFraction(state) {
    return this.clampNumber(state?.chemicalSizingPercent, 0, 100, DEFAULT_STATE.chemicalSizingPercent) / 100;
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

  getStepPrecision(step) {
    if (!Number.isFinite(step) || Number.isInteger(step)) return 0;
    const normalized = step.toString().toLowerCase();
    if (normalized.includes('e-')) {
      return parseInt(normalized.split('e-')[1], 10);
    }
    return normalized.includes('.') ? normalized.split('.')[1].length : 0;
  },

  snapRangeValue(value, min, max, step) {
    const precision = this.getStepPrecision(step);
    const boundedValue = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
    const snapped = min + (Math.round((boundedValue - min) / step) * step);
    return Number(Math.max(min, Math.min(max, snapped)).toFixed(precision));
  },

  buildEvenlySpacedIndices(totalSteps, targetCount) {
    if (totalSteps <= 0) return [0];

    const indices = new Set([0, totalSteps]);
    const count = Math.max(2, Math.min(targetCount, totalSteps + 1));
    for (let i = 0; i < count; i++) {
      indices.add(Math.round((i * totalSteps) / (count - 1)));
    }
    return Array.from(indices).sort((a, b) => a - b);
  },

  mergeIndexRanges(ranges) {
    if (!Array.isArray(ranges) || !ranges.length) return [];

    const sorted = ranges
      .map(([start, end]) => [Math.min(start, end), Math.max(start, end)])
      .sort((a, b) => a[0] - b[0]);

    return sorted.reduce((merged, [start, end]) => {
      const last = merged[merged.length - 1];
      if (!last || start > (last[1] + 1)) {
        merged.push([start, end]);
      } else {
        last[1] = Math.max(last[1], end);
      }
      return merged;
    }, []);
  },

  findBestRangeValueForIrr(baseState, {
    stateKey,
    min,
    max,
    step,
    currentValue,
    maxCoarseSamples = 257,
    maxTopRegions = 5,
  }, options = {}) {
    if (typeof stateKey !== 'string' || !stateKey) return null;
    if (![min, max, step].every(Number.isFinite) || step <= 0 || max < min) return null;

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    let lastPercent = -1;
    const emitProgress = (percent, stage) => {
      if (!onProgress) return;
      const boundedPercent = Math.max(0, Math.min(100, Math.round(percent)));
      if (boundedPercent <= lastPercent && stage !== 'done') return;
      lastPercent = Math.max(lastPercent, boundedPercent);
      try {
        onProgress({ percent: lastPercent, stage });
      } catch (error) {
        // Progress reporting should never change optimizer behavior.
      }
    };

    const totalSteps = Math.max(0, Math.round((max - min) / step));
    const snappedCurrentValue = this.snapRangeValue(currentValue, min, max, step);
    const currentIndex = Math.round((snappedCurrentValue - min) / step);
    const precision = this.getStepPrecision(step);
    const cache = new Map();

    const evaluate = value => {
      const snappedValue = this.snapRangeValue(value, min, max, step);
      const key = snappedValue.toFixed(precision);
      if (cache.has(key)) return cache.get(key);

      const result = {
        value: snappedValue,
        irr: this.calculateIrr({ ...baseState, [stateKey]: snappedValue }),
      };
      result.finite = Number.isFinite(result.irr);
      cache.set(key, result);
      return result;
    };

    const evaluateIndex = index => evaluate(min + (index * step));
    emitProgress(0, 'start');
    const currentResult = evaluate(snappedCurrentValue);
    emitProgress(6, 'seed');

    if ((totalSteps + 1) <= maxCoarseSamples) {
      for (let index = 0; index <= totalSteps; index++) {
        evaluateIndex(index);
        emitProgress(6 + (((index + 1) / Math.max(totalSteps + 1, 1)) * 90), 'sweep');
      }
    } else {
      const coarseIndices = this.buildEvenlySpacedIndices(
        totalSteps,
        Math.min(maxCoarseSamples, totalSteps + 1)
      );

      coarseIndices.forEach((index, coarseIndex) => {
        evaluateIndex(index);
        emitProgress(6 + (((coarseIndex + 1) / Math.max(coarseIndices.length, 1)) * 34), 'coarse');
      });

      const rankedIndices = coarseIndices
        .map(index => ({ index, ...evaluateIndex(index) }))
        .filter(entry => entry.finite)
        .sort((a, b) => b.irr - a.irr);

      const coarseSpacing = coarseIndices.length > 1
        ? coarseIndices.slice(1).reduce((maxGap, index, i) => Math.max(maxGap, index - coarseIndices[i]), 1)
        : totalSteps;

      const regionSeeds = new Set([
        currentIndex,
        ...rankedIndices.slice(0, maxTopRegions).map(entry => entry.index),
      ]);

      const mergedRegions = this.mergeIndexRanges(
        Array.from(regionSeeds).map(index => [
          Math.max(0, index - coarseSpacing),
          Math.min(totalSteps, index + coarseSpacing),
        ])
      );
      emitProgress(42, 'rank');

      const refinementCount = mergedRegions.reduce((sum, [start, end]) => sum + (end - start + 1), 0);
      let refinedSteps = 0;

      mergedRegions.forEach(([start, end]) => {
        for (let index = start; index <= end; index++) {
          evaluateIndex(index);
          refinedSteps += 1;
          emitProgress(42 + ((refinedSteps / Math.max(refinementCount, 1)) * 54), 'refine');
        }
      });
    }

    const best = Array.from(cache.values())
      .filter(entry => entry.finite)
      .sort((a, b) => {
        const irrDiff = b.irr - a.irr;
        if (Math.abs(irrDiff) > 1e-9) return irrDiff;
        return Math.abs(a.value - snappedCurrentValue) - Math.abs(b.value - snappedCurrentValue);
      })[0];

    if (!best) {
      emitProgress(100, 'done');
      return null;
    }
    if (Number.isFinite(currentResult.irr) && best.irr <= (currentResult.irr + 1e-6)) {
      emitProgress(100, 'done');
      return null;
    }

    emitProgress(100, 'done');

    return {
      bestValue: best.value,
      bestIrr: best.irr,
      currentValue: snappedCurrentValue,
      currentIrr: currentResult.irr,
    };
  },

  getModuleById(moduleId) {
    return ModuleCatalog.getById(moduleId);
  },

  moduleSupportsFeedBuffer(moduleId, route = null) {
    const module = this.getModuleById(moduleId);
    if (!module) return false;
    if (module.supportsFeedBuffer) return true;
    if (!ModuleCatalog.hasRoutes(module)) return false;

    const routeToCheck = route || ModuleCatalog.getDefaultRoute(module);
    const routeConfig = routeToCheck ? ModuleCatalog.getRouteConfig(moduleId, routeToCheck) : null;
    return Boolean(routeConfig?.supportsFeedBuffer);
  },

  hasModuleFeedBufferSupport(moduleId) {
    const module = this.getModuleById(moduleId);
    if (!module) return false;
    if (module.supportsFeedBuffer) return true;
    return Boolean(ModuleCatalog.getRouteOptions(module).some(option => this.moduleSupportsFeedBuffer(moduleId, option.value)));
  },

  getModuleFeedBufferLabel(moduleId, route = null) {
    const module = this.getModuleById(moduleId);
    if (!module) return 'Feed buffer (cycle-average sizing)';
    if (module.bufferLabel) return module.bufferLabel;

    const routeToCheck = route || ModuleCatalog.getDefaultRoute(module);
    const routeConfig = routeToCheck ? ModuleCatalog.getRouteConfig(moduleId, routeToCheck) : null;
    return routeConfig?.bufferLabel || 'Feed buffer (cycle-average sizing)';
  },

  isModuleFeedBufferEnabled(state = {}, moduleId, route = null) {
    return this.moduleSupportsFeedBuffer(moduleId, route) && Boolean(state?.[`${moduleId}BufferEnabled`]);
  },

  getDirectModuleDependencies(moduleId, state = {}) {
    return ModuleCatalog.getDependencies(moduleId, state);
  },

  normalizeCoreStateFields(input = {}, normalized = {}) {
    const enumOrDefault = (value, allowed, fallback) => (allowed.has(value) ? value : fallback);

    CORE_STATE_FIELDS.forEach(field => {
      if (field.type === 'enum') {
        normalized[field.key] = enumOrDefault(
          input[field.key],
          new Set(getStateFieldOptions(field)),
          field.defaultValue
        );
        return;
      }

      if (field.type === 'integer') {
        const max = typeof field.getMax === 'function' ? field.getMax(normalized) : field.max;
        normalized[field.key] = this.clampInteger(
          input[field.key],
          field.min,
          max,
          field.defaultValue
        );
        return;
      }

      if (field.type === 'number') {
        normalized[field.key] = this.clampNumber(
          input[field.key],
          field.min,
          field.max,
          field.defaultValue
        );
        return;
      }

      if (field.type === 'boolean') {
        normalized[field.key] = Boolean(normalized[field.key]);
      }
    });
  },

  normalizeModuleStateFields(input = {}, normalized = {}) {
    ModuleCatalog.getAll().forEach(module => {
      const enabledKey = `${module.id}Enabled`;
      normalized[enabledKey] = Boolean(normalized[enabledKey]);
      normalized[`${module.id}BufferEnabled`] = Boolean(normalized[`${module.id}BufferEnabled`]);

      ModuleCatalog.getConfigFields(module).forEach(config => {
        const fallback = Object.prototype.hasOwnProperty.call(config, 'defaultValue')
          ? config.defaultValue
          : DEFAULT_STATE[config.key];
        normalized[config.key] = this.clampNumber(
          input[config.key],
          config.min,
          config.max,
          fallback
        );
      });

      const assetLifeKey = ModuleCatalog.getAssetLifeKey(module);
      if (assetLifeKey) {
        normalized[assetLifeKey] = this.clampInteger(
          input[assetLifeKey],
          1,
          100,
          DEFAULT_STATE[assetLifeKey] ?? ModuleCatalog.getDefaultAssetLife(module)
        );
      }

      if (ModuleCatalog.hasRoutes(module)) {
        const fallbackRoute = ModuleCatalog.getDefaultRoute(module);
        const routeOptions = new Set(ModuleCatalog.getRouteOptions(module).map(option => option.value));
        normalized[`${module.id}Route`] = routeOptions.has(input[`${module.id}Route`])
          ? input[`${module.id}Route`]
          : fallbackRoute;
      }

      if (module.exploratory) {
        normalized[`${module.id}PriorityWeight`] = this.clampNumber(
          input[`${module.id}PriorityWeight`],
          0,
          100,
          DEFAULT_STATE[`${module.id}PriorityWeight`] ?? module.defaultPriorityWeight ?? 100
        );
        const capexControl = this.getModuleCapexControlConfig(
          module.id,
          normalized[`${module.id}Route`]
        );
        normalized[`${module.id}CapexBasis`] = this.clampNumber(
          input[`${module.id}CapexBasis`],
          capexControl.min,
          capexControl.max,
          DEFAULT_STATE[`${module.id}CapexBasis`] ?? capexControl.defaultValue
        );
      }

      const marketConfig = ModuleCatalog.getMarketConfig(module.id, normalized[`${module.id}Route`]);
      if (marketConfig) {
        normalized[`${module.id}Price`] = this.clampNumber(
          input[`${module.id}Price`],
          marketConfig.min,
          marketConfig.max,
          DEFAULT_STATE[`${module.id}Price`] ?? marketConfig.defaultValue
        );
      }
    });
  },

  enforceModuleDependencies(rawState = {}) {
    const nextState = rawState && typeof rawState === 'object'
      ? { ...rawState }
      : {};

    let changed = true;
    while (changed) {
      changed = false;
      for (const module of ModuleCatalog.getAll()) {
        if (!nextState[`${module.id}Enabled`]) continue;

        for (const dependencyId of this.getDirectModuleDependencies(module.id, nextState)) {
          if (!this.getModuleById(dependencyId)) continue;
          const dependencyKey = `${dependencyId}Enabled`;
          if (nextState[dependencyKey]) continue;
          nextState[dependencyKey] = true;
          changed = true;
        }
      }
    }

    return nextState;
  },

  normalizeState(rawState = {}) {
    const input = PolicyModel.normalizeLegacyState(
      rawState && typeof rawState === 'object' ? rawState : {}
    );
    const normalized = {
      ...DEFAULT_STATE,
      ...input,
    };
    this.normalizeCoreStateFields(input, normalized);

    const solarProfileFallback =
      SOLAR_PROFILE_DEFAULTS_BY_BODY[normalized.body] || DEFAULT_STATE.solarProfileModel;
    const allowedProfiles = new Set(
      SOLAR_PROFILE_OPTIONS_BY_BODY[normalized.body] || [solarProfileFallback]
    );
    normalized.solarProfileModel = allowedProfiles.has(input.solarProfileModel)
      ? input.solarProfileModel
      : solarProfileFallback;

    if (normalized.aiComputeEnabled && normalized.batteryCapacityMWh <= 1e-9) {
      // Seed AI mode with a simple default: 1 MWh of storage per 1 GWh/year of solar.
      normalized.batteryCapacityMWh = this.getAiBatteryHeuristicMWh(normalized);
    }

    this.normalizeModuleStateFields(input, normalized);
    Object.assign(normalized, this.enforceModuleDependencies(normalized));

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

  approximateIRR(cashFlows, preferredRate = 0.1) {
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
      let highNpv = npvHi;

      for (let i = 0; i < 60; i++) {
        const mid = (low + high) / 2;
        const npvMid = npvAt(mid);
        if (npvMid === 0) return mid;
        if (lowNpv * npvMid > 0) {
          low = mid;
          lowNpv = npvMid;
        } else {
          high = mid;
          highNpv = npvMid;
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
  },
});
