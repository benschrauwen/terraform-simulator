/* UI state sync helpers attached to App */

function formatAllocationBasisLabel(label) {
  if (label === 'configured product mix') return 'Product mix';
  if (label === 'default methane case') return 'Default case';
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : 'Auto';
}

const AppUiStateMethods = {
  syncPlanetaryUI() {
    const body = this.getBodyConfig();
    const averageTab = document.querySelector('.day-tab[data-mode="average"]');
    const specificTab = document.querySelector('.day-tab[data-mode="specific"]');
    const specificControls = document.getElementById('daySpecificControls');
    const dayModeNote = document.getElementById('dayModeNote');
    const irradianceLabel = document.getElementById('irradianceLabel');
    const sunHoursLabel = document.getElementById('sunHoursLabel');
    const opHoursLabel = document.getElementById('dailyOpHoursLabel');
    const siteYieldNote = document.getElementById('siteYieldNote');
    const powerChartNote = document.getElementById('powerChartNote');

    if (!body.supportsSpecificDay && this.state.dayMode === 'specific') {
      this.state.dayMode = 'average';
    }

    document.querySelectorAll('.day-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === this.state.dayMode);
    });

    if (averageTab) averageTab.disabled = false;
    if (specificTab) {
      specificTab.disabled = !body.supportsSpecificDay;
      specificTab.classList.toggle('disabled', !body.supportsSpecificDay);
    }
    if (specificControls) {
      specificControls.style.display = body.supportsSpecificDay && this.state.dayMode === 'specific' ? 'block' : 'none';
    }
    if (dayModeNote) {
      dayModeNote.textContent = body.supportsSpecificDay
        ? ''
        : `${body.label} uses an average local solar cycle; specific Earth calendar days are disabled.`;
    }
    if (irradianceLabel) {
      irradianceLabel.textContent = body.label === 'Earth' ? 'GHI:' : 'Annual irradiation:';
    }
    if (sunHoursLabel) {
      sunHoursLabel.textContent = body.label === 'Earth' ? 'Avg Sun Hours:' : 'Illumination / cycle:';
    }
    if (opHoursLabel) {
      opHoursLabel.textContent = body.label === 'Earth' ? 'Daily Op Hours:' : 'Op Hours / Cycle:';
    }
    if (siteYieldNote) {
      siteYieldNote.innerHTML = body.label === 'Earth'
        ? `This is the long-run annual PV output per MWdc. For a more accurate site-specific number, use a
            cloud/weather-adjusted source such as
            <a href="https://joint-research-centre.ec.europa.eu/pvgis-online-tool_en" target="_blank" rel="noopener noreferrer">PVGIS</a>
            or
            <a href="https://globalsolaratlas.info/" target="_blank" rel="noopener noreferrer">Global Solar Atlas PVOUT</a>.`
        : body.siteYieldNote;
    }
    if (powerChartNote) {
      powerChartNote.textContent = body.chartNote || '';
    }
  },

  syncDynamicVisibility() {
    const results = this.lastResults;
    const generatedExploratoryIds = new Set(
      (results?.exploratoryModules || [])
        .filter(module => module.enabled && module.outputDailyUnits > 0)
        .map(module => module.id)
    );
    const showMethaneMarket = results
      ? Boolean(results.sabatier?.enabled && results.sabatier?.ch4AnnualMCF > 0)
      : Boolean(this.state.sabatierEnabled);
    const showMethanolMarket = results
      ? Boolean(results.methanol?.enabled && (results.methanol?.exportAnnualTons || 0) > 0)
      : Boolean(this.state.methanolEnabled);

    const methaneMarket = this.getMethaneMarketConfig();
    const methaneMarketApplicability = document.getElementById('methaneMarketApplicabilityValue');
    if (methaneMarketApplicability) methaneMarketApplicability.textContent = methaneMarket.applicability;

    const methaneMarketBasis = document.getElementById('methaneMarketBasisValue');
    if (methaneMarketBasis) methaneMarketBasis.textContent = methaneMarket.basis;

    const methaneMarketNote = document.getElementById('methaneMarketNote');
    if (methaneMarketNote) methaneMarketNote.textContent = methaneMarket.note;

    const policy = this.getPolicyConfig();
    const showCustomH2 = Boolean(policy.useCustomH2);
    const showCustomCo2 = Boolean(policy.useCustomCo2);

    const customH2Wrap = document.getElementById('customH2CreditWrap');
    if (customH2Wrap) customH2Wrap.style.display = showCustomH2 ? 'block' : 'none';

    const customCo2Wrap = document.getElementById('customCo2CreditWrap');
    if (customCo2Wrap) customCo2Wrap.style.display = showCustomCo2 ? 'block' : 'none';

    const customH2Label = document.getElementById('customH2CreditLabel');
    if (customH2Label) {
      customH2Label.textContent = policy.h2InputLabel || 'Custom H2 Credit ($/kg)';
    }

    const customCo2Label = document.getElementById('customCo2CreditLabel');
    if (customCo2Label) {
      customCo2Label.textContent = policy.co2InputLabel || 'Custom CO2 Credit ($/ton)';
    }

    const policyApplicability = document.getElementById('policyApplicabilityValue');
    if (policyApplicability) policyApplicability.textContent = policy.applicability;

    const policyBasis = document.getElementById('policyBasisValue');
    if (policyBasis) policyBasis.textContent = policy.basis;

    const stackingRule = document.getElementById('stackingRuleValue');
    if (stackingRule) stackingRule.textContent = policy.stackingRule;

    const policyNote = document.getElementById('policyNote');
    if (policyNote) policyNote.textContent = policy.note;

    const usPolicyFootnotes = document.getElementById('usPolicyFootnotes');
    if (usPolicyFootnotes) {
      const isUsPolicy = String(this.state.policyMode || '').startsWith('us_');
      usPolicyFootnotes.style.display = isUsPolicy ? '' : 'none';
    }

    const debtTermInput = document.getElementById('debtTermYears');
    if (debtTermInput) {
      const horizonYears = Math.max(1, Math.round(this.state.analysisHorizonYears || 1));
      this.state.debtTermYears = Math.max(1, Math.min(Math.round(this.state.debtTermYears || 1), horizonYears));
      debtTermInput.max = String(horizonYears);
      debtTermInput.value = String(this.state.debtTermYears);
      this.syncRangeDisplay('debtTermYears', this.state.debtTermYears);

      const financingTermNote = document.getElementById('financingTermNote');
      if (financingTermNote) {
        financingTermNote.textContent = `Debt term is capped by the selected ${FormatNumbers.fixed(horizonYears, 0)}-year analysis horizon.`;
      }
    }

    const methaneMarketWrap = document.getElementById('methaneMarketWrap');
    if (methaneMarketWrap) methaneMarketWrap.style.display = showMethaneMarket ? 'block' : 'none';

    const methanolMarketWrap = document.getElementById('methanolMarketWrap');
    if (methanolMarketWrap) methanolMarketWrap.style.display = showMethanolMarket ? 'block' : 'none';

    MODULE_REGISTRY
      .filter(module => module.maturity === 'Exploratory' && EXPLORATORY_MARKET_CONFIG[module.id])
      .forEach(module => {
        const wrap = document.getElementById(`${module.id}MarketWrap`);
        const showWrap = results ? generatedExploratoryIds.has(module.id) : Boolean(this.state[`${module.id}Enabled`]);
        if (wrap) wrap.style.display = showWrap ? 'block' : 'none';
      });

    const exploratoryOmWrap = document.getElementById('exploratoryOmWrap');
    if (exploratoryOmWrap) {
      const showWrap = results
        ? generatedExploratoryIds.size > 0
        : MODULE_REGISTRY.some(module => module.maturity === 'Exploratory' && this.state[`${module.id}Enabled`]);
      exploratoryOmWrap.style.display = showWrap ? 'block' : 'none';
    }

    const productMarketEmptyState = document.getElementById('productMarketEmptyState');
    if (productMarketEmptyState) {
      const hasVisibleMarketControl = showMethaneMarket || showMethanolMarket || generatedExploratoryIds.size > 0;
      productMarketEmptyState.style.display = hasVisibleMarketControl ? 'none' : 'block';
    }

    MODULE_REGISTRY
      .filter(module => module.maturity === 'Exploratory')
      .forEach(module => {
        AppUiStateMethods.syncExploratoryCapexControl.call(this, module.id);
      });
  },

  syncExploratoryCapexControl(moduleId) {
    const input = document.getElementById(`${moduleId}CapexBasis`);
    const label = document.getElementById(`${moduleId}CapexBasisLabel`);
    if (!input) return;

    const capexConfig = Calc.getExploratoryCapexControlConfig(moduleId, this.state[`${moduleId}Route`]);
    input.min = String(capexConfig.min);
    input.max = String(capexConfig.max);
    input.step = String(capexConfig.step);
    this.state[`${moduleId}CapexBasis`] = Calc.clampNumber(
      this.state[`${moduleId}CapexBasis`],
      capexConfig.min,
      capexConfig.max,
      capexConfig.defaultValue
    );
    input.value = String(this.state[`${moduleId}CapexBasis`]);
    if (label) label.textContent = `CAPEX (${capexConfig.unitLabel})`;
    this.syncRangeDisplay(
      `${moduleId}CapexBasis`,
      this.state[`${moduleId}CapexBasis`],
      value => this.formatExploratoryCapexBasis(moduleId, value)
    );
  },

  syncDerivedFeedControls() {
    const safeState = Calc.normalizeState(this.state);
    const allocation = Calc.getBalancedAllocation(safeState);
    const mix = Calc.getProductMix(safeState);
    const mixControl = document.getElementById('productMixControl');
    const mixNote = document.getElementById('productMixNote');
    const mixInput = document.getElementById('methaneFeedstockSplit');

    if (mixControl) {
      mixControl.style.display = mix.bothEnabled ? 'block' : 'none';
    }
    if (mixInput) {
      mixInput.value = this.state.methaneFeedstockSplit;
    }
    this.syncRangeDisplay(
      'methaneFeedstockSplit',
      this.state.methaneFeedstockSplit,
      value => this.formatMethaneFeedstockSplit(value)
    );
    if (mixNote) {
      mixNote.textContent = mix.bothEnabled
        ? 'Shared H2 and CO2 production auto-balance from the combined methane and methanol demand.'
        : 'Shared H2 and CO2 production auto-balance from the active downstream product requirements.';
    }

    const mtgSplitControl = document.getElementById('mtgMethanolSplitControl');
    if (mtgSplitControl) {
      mtgSplitControl.style.display = this.state.mtgEnabled && this.state.methanolEnabled ? 'block' : 'none';
    }
    const mtgSplitInput = document.getElementById('mtgMethanolSplit');
    if (mtgSplitInput) {
      mtgSplitInput.value = this.state.mtgMethanolSplit;
      this.syncRangeDisplay(
        'mtgMethanolSplit',
        this.state.mtgMethanolSplit,
        value => this.formatMtgMethanolSplit(value)
      );
    }

    ['electrolyzer', 'dac'].forEach(id => {
      const el = document.getElementById(`${id}AllocMode`);
      if (el) {
        const pct = id === 'electrolyzer' ? allocation.electrolyzer * 100 : allocation.dac * 100;
        el.textContent = `${formatAllocationBasisLabel(allocation.label)} · ${FormatNumbers.fixed(pct, 1)}% of power`;
      }
    });
  },
};

window.AppUiStateMethods = AppUiStateMethods;
