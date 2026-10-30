/* Result-dependent visibility and derived read-outs (planetary labels, markets, feed split) */

import { Calc } from '../model/index.js';
import { ModuleCatalog } from '../model/module-catalog.js';
import { FormatNumbers } from './format-numbers.js';

function formatAllocationBasisLabel(label) {
  if (label === 'configured product mix') return 'Product mix';
  if (label === 'default methane case') return 'Default case';
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : 'Auto';
}

export const uiStateMethods = {
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
      const isActive = tab.dataset.mode === this.state.dayMode;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-pressed', String(isActive));
    });

    if (averageTab) {
      averageTab.disabled = false;
      averageTab.setAttribute('aria-disabled', 'false');
    }
    if (specificTab) {
      specificTab.disabled = !body.supportsSpecificDay;
      specificTab.classList.toggle('disabled', !body.supportsSpecificDay);
      specificTab.setAttribute('aria-disabled', String(!body.supportsSpecificDay));
    }
    if (specificControls) {
      const showSpecificControls = body.supportsSpecificDay && this.state.dayMode === 'specific';
      specificControls.hidden = !showSpecificControls;
      specificControls.setAttribute('aria-hidden', String(!showSpecificControls));
    }
    if (dayModeNote) {
      dayModeNote.textContent = body.supportsSpecificDay
        ? ''
        : `${body.label} uses an average local solar cycle; specific Earth calendar days are disabled.`;
    }
    if (irradianceLabel) {
      const lunarPolar = this.state.body === 'moon' && this.state.solarProfileModel === 'lunar-pel';
      irradianceLabel.textContent = body.label === 'Earth'
        ? 'GHI:'
        : (lunarPolar ? 'Annual irradiation (sun-facing):' : 'Annual irradiation (horizontal):');
      irradianceLabel.dataset.tooltip = body.label === 'Earth'
        ? 'Global horizontal irradiance: yearly sunlight energy hitting a flat surface.'
        : (lunarPolar
            ? 'Yearly sunlight on a surface facing the Sun. At the lunar pole the Sun grazes the horizon, so a flat surface receives almost none.'
            : 'Yearly sunlight energy reaching a horizontal surface.');
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

    const policyApplicability = document.getElementById('policyApplicabilityValue');
    if (policyApplicability) policyApplicability.textContent = policy.jurisdiction || 'None selected';

    const policyBasis = document.getElementById('policyBasisValue');
    if (policyBasis) policyBasis.textContent = policy.basis;

    const stackingRule = document.getElementById('stackingRuleValue');
    if (stackingRule) stackingRule.textContent = policy.stackingOrExclusivity;

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

    const visibleModuleMarketIds = new Set();
    ModuleCatalog.getExploratoryModules().forEach(module => {
      const wrap = document.getElementById(`${module.id}MarketWrap`);
      const hasMarket = ModuleCatalog.hasMarket(module.id, this.state[`${module.id}Route`]);
      const showWrap = hasMarket && (results ? generatedExploratoryIds.has(module.id) : Boolean(this.state[`${module.id}Enabled`]));
      if (wrap) wrap.style.display = showWrap ? 'block' : 'none';
      if (showWrap) visibleModuleMarketIds.add(module.id);
    });

    const exploratoryOmWrap = document.getElementById('exploratoryOmWrap');
    if (exploratoryOmWrap) {
      const showWrap = results
        ? generatedExploratoryIds.size > 0
        : ModuleCatalog.getExploratoryModules().some(module => this.state[`${module.id}Enabled`]);
      exploratoryOmWrap.style.display = showWrap ? 'block' : 'none';
    }

    const productMarketEmptyState = document.getElementById('productMarketEmptyState');
    if (productMarketEmptyState) {
      const hasVisibleMarketControl = showMethaneMarket || showMethanolMarket || visibleModuleMarketIds.size > 0;
      productMarketEmptyState.style.display = hasVisibleMarketControl ? 'none' : 'block';
    }

    ModuleCatalog.getExploratoryModules().forEach(module => {
      this.syncModuleCapexControl(module.id);
      this.syncModuleMarketControl(module.id);
      this.syncModuleBufferControl(module.id);
    });
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
    this.syncRangeDisplay('methaneFeedstockSplit', this.state.methaneFeedstockSplit);
    if (mixNote) {
      mixNote.textContent = mix.bothEnabled
        ? 'H2 and CO2 production are sized to the stoichiometric feed of this split, so only reactor conversion losses go unused.'
        : 'Shared H2 and CO2 production auto-balance from the active downstream product requirements.';
    }

    const mtgSplitControl = document.getElementById('mtgMethanolSplitControl');
    if (mtgSplitControl) {
      mtgSplitControl.style.display = this.state.mtgEnabled && this.state.methanolEnabled ? 'block' : 'none';
    }
    const mtgSplitInput = document.getElementById('mtgMethanolSplit');
    if (mtgSplitInput) {
      mtgSplitInput.value = this.state.mtgMethanolSplit;
      this.syncRangeDisplay('mtgMethanolSplit', this.state.mtgMethanolSplit);
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
