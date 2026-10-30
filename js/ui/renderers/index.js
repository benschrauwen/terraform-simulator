/* Result panels attached to App: info read-outs, header metrics, score, production, economics, impact */

import { SolarGeometry } from '../../model/solar-geometry.js';
import { Diagram } from '../diagram.js';
import { FormatNumbers } from '../format-numbers.js';
import { formatIrr, formatSystemSizeMW } from '../formatters.js';
import { renderEconomicsBreakdown } from './economics.js';
import { applyTooltip, EDUCATIONAL_TOOLTIPS, prodItem } from './markup.js';

export const rendererMethods = {
  updateInfoDisplays(r) {
    document.getElementById('ghiValue').textContent = `${FormatNumbers.fixed(r.solar.ghi, 0)} kWh/m²/yr`;
    document.getElementById('sunHoursValue').textContent = `${FormatNumbers.fixed(r.solar.sunHours, 1)} ${r.solar.hoursPerCycleLabel}`;
    document.getElementById('baseYieldValue').textContent = `${FormatNumbers.fixed(r.solar.baseYield, 0)} MWh/MWdc-yr`;
    const mountingYieldMultValue = document.getElementById('mountingYieldMultValue');
    if (mountingYieldMultValue) {
      mountingYieldMultValue.textContent = `${FormatNumbers.fixed(r.solar.yieldMult, 3)}× vs ${r.solar.baseYieldReference}`;
    }
    document.getElementById('annualProduction').textContent = `${FormatNumbers.fixed(r.solar.annualMWh, 0)} MWh`;
    document.getElementById('capacityFactor').textContent = `${FormatNumbers.fixed(r.solar.capacityFactor * 100, 1)}%`;
    document.getElementById('lcoe').textContent = `$${FormatNumbers.fixed(r.solar.lcoe, 2)}/MWh`;
    const solarInstallCapex = document.getElementById('solarInstallCapex');
    if (solarInstallCapex) {
      solarInstallCapex.textContent = FormatNumbers.formatMoney(r.solar.totalSolarCapex);
    }

    const effectiveCfLabel = document.getElementById('effectiveCFLabel');
    if (effectiveCfLabel) {
      effectiveCfLabel.textContent = r.ai.enabled ? 'Residual Chem CF:' : 'Effective CF:';
      applyTooltip(
        effectiveCfLabel,
        r.ai.enabled ? EDUCATIONAL_TOOLTIPS.residualChemCf : EDUCATIONAL_TOOLTIPS.effectiveCf
      );
    }
    const dailyOpHoursLabel = document.getElementById('dailyOpHoursLabel');
    if (dailyOpHoursLabel) {
      dailyOpHoursLabel.textContent = r.ai.enabled
        ? (r.solar.bodyKey === 'earth' ? 'Residual Chem Hrs/Day:' : 'Residual Chem Hrs/Cycle:')
        : 'Daily Op Hours:';
      applyTooltip(
        dailyOpHoursLabel,
        r.ai.enabled
          ? (r.solar.bodyKey === 'earth'
            ? EDUCATIONAL_TOOLTIPS.residualChemHoursDay
            : EDUCATIONAL_TOOLTIPS.residualChemHoursCycle)
          : EDUCATIONAL_TOOLTIPS.dailyOpHours
      );
    }
    const useChemicalUtilizationMetrics = r.ai.enabled ||
      r.storage.enabled ||
      (r.chemicalSupply?.sizingPercent ?? 100) < 99.999 ||
      (r.chemicalSupply?.clippedDailyKWh || 0) > 1e-6;
    const displayedCf = r.ai.enabled
      ? r.chemicalSupply.effectiveCF
      : (useChemicalUtilizationMetrics ? r.chemicalSupply.effectiveCF : r.solar.capacityFactor);
    const displayedHours = r.ai.enabled
      ? r.ai.chemicalDailyOpHours
      : (useChemicalUtilizationMetrics ? r.chemicalSupply.dailyOpHours : r.solar.sunHours);
    document.getElementById('effectiveCF').textContent = `${FormatNumbers.fixed(displayedCf * 100, 1)}%`;
    document.getElementById('dailyOpHours').textContent = `${FormatNumbers.fixed(parseFloat(displayedHours), 1)} hrs`;
    const bufferedElectricityCost = document.getElementById('bufferedElectricityCost');
    if (bufferedElectricityCost) {
      bufferedElectricityCost.textContent = `$${FormatNumbers.fixed(r.economics.bufferedElectricityCostPerMWh, 2)}/MWh`;
    }

    const aiDesignLoadValue = document.getElementById('aiDesignLoadValue');
    const aiUtilizationValue = document.getElementById('aiUtilizationValue');
    const aiFullRateValue = document.getElementById('aiFullRateValue');
    const aiTokensAnnualValue = document.getElementById('aiTokensAnnualValue');
    if (aiDesignLoadValue) {
      aiDesignLoadValue.textContent = r.ai.enabled ? formatSystemSizeMW(r.ai.designLoadKW / 1000) : 'Off';
    }
    if (aiUtilizationValue) {
      aiUtilizationValue.textContent = r.ai.enabled ? `${FormatNumbers.fixed(r.ai.utilization * 100, 2)}%` : '—';
    }
    if (aiFullRateValue) {
      aiFullRateValue.textContent = r.ai.enabled ? `${FormatNumbers.fixed(r.ai.fullPowerReliability * 100, 2)}%` : '—';
    }
    if (aiTokensAnnualValue) {
      aiTokensAnnualValue.textContent = r.ai.enabled ? `${FormatNumbers.fixed(r.ai.annualTokensM / 1000, 2)}B` : '—';
    }

    const geo = this.getDisplaySolarGeometry(r);
    if (geo) {
      document.getElementById('sunriseTime').textContent = SolarGeometry.hoursToDisplayString(geo.sunrise, r.solar.cycleHours);
      document.getElementById('sunsetTime').textContent = SolarGeometry.hoursToDisplayString(geo.sunset, r.solar.cycleHours);
      document.getElementById('dayLength').textContent = `${FormatNumbers.fixed(geo.dayLengthHours, 1)} hrs`;
    }
  },

  updateHeaderMetrics(r) {
    const e = r.economics;
    document.getElementById('metricCapex').textContent = FormatNumbers.formatMoney(e.totalCapex);
    document.getElementById('metricRevenue').textContent = `${FormatNumbers.formatMoney(e.totalAnnualRevenue)}/yr`;
    document.getElementById('metricPayback').textContent = Number.isFinite(e.paybackYears) ? `${FormatNumbers.fixed(e.paybackYears, 1)} yrs` : 'No payback';
    const irrLabel = document.getElementById('metricIrrLabel');
    if (irrLabel) {
      irrLabel.textContent = e.financing.enabled ? 'Equity IRR' : 'IRR';
      applyTooltip(
        irrLabel,
        e.financing.enabled ? EDUCATIONAL_TOOLTIPS.equityIrr : EDUCATIONAL_TOOLTIPS.projectIrr
      );
    }
    document.getElementById('metricIRR').textContent = formatIrr(e.irr);

    const financingHeadlineValue = document.getElementById('financingHeadlineValue');
    if (financingHeadlineValue) {
      financingHeadlineValue.textContent = e.financing.enabled
        ? 'Sponsor equity IRR (levered)'
        : 'Project IRR (unlevered)';
    }

    const financingScopeValue = document.getElementById('financingScopeValue');
    if (financingScopeValue) {
      financingScopeValue.textContent = e.financing.enabled
        ? e.financing.debtAmount > 0
          ? `${FormatNumbers.fixed(e.financing.debtSharePercent, 0)}% of upfront CAPEX debt-funded at close`
          : '0% debt share; equivalent to unlevered project funding'
        : 'Debt disabled; project cash flows stay unlevered';
    }

    const financingTermCapValue = document.getElementById('financingTermCapValue');
    if (financingTermCapValue) {
      const analysisHorizonYears = Math.max(1, Math.round(this.state.analysisHorizonYears || 1));
      financingTermCapValue.textContent = e.financing.enabled
        ? `${FormatNumbers.fixed(e.financing.debtTermYears, 0)}-year debt term within ${FormatNumbers.fixed(analysisHorizonYears, 0)}-year analysis`
        : `Max ${FormatNumbers.fixed(analysisHorizonYears, 0)} years from the analysis horizon`;
    }

    const viability = document.getElementById('metricViability');
    const label = document.getElementById('metricViabilityValue');
    viability.classList.remove('viable', 'marginal', 'not-viable');

    if (e.npv > 0 && e.paybackYears < this.state.analysisHorizonYears) {
      viability.classList.add('viable');
      label.textContent = 'Viable';
    } else if (e.npv > 0 || e.finalCumulativeNetCash > 0) {
      viability.classList.add('marginal');
      label.textContent = 'Marginal';
    } else {
      viability.classList.add('not-viable');
      label.textContent = 'Not viable';
    }
  },

  updatePlantScore(r) {
    const e = r.economics;
    let score = 0;
    const badges = [];

    if (e.roi > 0) {
      score += Math.min(30, Math.max(8, e.roi / 6));
      if (e.roi > 40) badges.push({ text: 'High ROI', cls: 'green' });
    }

    if (e.paybackYears < this.state.analysisHorizonYears) {
      score += Math.min(20, Math.max(6, (1 - e.paybackYears / this.state.analysisHorizonYears) * 20));
      if (e.paybackYears < 5) badges.push({ text: 'Fast Payback', cls: 'gold' });
    }

    const cf = (r.storage.enabled || (r.chemicalSupply?.sizingPercent ?? 100) < 99.999 || (r.chemicalSupply?.clippedDailyKWh || 0) > 1e-6)
      ? r.chemicalSupply.effectiveCF
      : r.solar.capacityFactor;
    score += cf * 18;
    if (cf > 0.22) badges.push({ text: 'High Utilization', cls: 'blue' });

    const h2Util = r.electrolyzer.enabled && r.electrolyzer.h2DailyKg > 0
      ? 1 - (r.h2Surplus / r.electrolyzer.h2DailyKg)
      : 0;
    score += Math.max(0, h2Util) * 10;
    if (h2Util > 0.9) badges.push({ text: 'Balanced Feeds', cls: 'green' });

    if (r.sabatier.enabled && r.sabatier.designHourlyRate >= 0.8) {
      score += 5;
      badges.push({ text: 'Near Design Rate', cls: 'gold' });
    }

    score = Math.round(Math.min(100, Math.max(0, score)));
    const circumference = 213.6;
    const offset = circumference - (score / 100) * circumference;
    const arc = document.getElementById('scoreArc');
    arc.setAttribute('stroke-dashoffset', offset);
    arc.setAttribute('stroke', score >= 70 ? '#7ea96d' : score >= 40 ? '#c79a48' : '#c77379');
    document.getElementById('scoreNumber').textContent = FormatNumbers.fixed(score, 0);
    document.getElementById('scoreBadges').innerHTML = badges.slice(0, 4)
      .map(badge => `<span class="badge ${badge.cls}">${badge.text}</span>`)
      .join('');

    const card = document.getElementById('plantScoreCard');
    card.classList.remove('viable', 'marginal', 'not-viable');
    card.classList.add(score >= 60 ? 'viable' : score >= 35 ? 'marginal' : 'not-viable');
  },

  updateDiagram(r) {
    Diagram.render(document.getElementById('diagramContainer'), this.buildDiagramDisplayResults(r));
  },

  updateProduction(r) {
    const cycleUnit = this.getCycleRateUnit(r);
    const rows = [
      prodItem('solar', '☀️', 'Electricity', `${FormatNumbers.fixed(r.solar.annualMWh, 0)}`, 'MWh/yr'),
    ];

    if (r.ai.enabled) {
      rows.push(prodItem('electric', '🧠', 'AI Tokens', `${FormatNumbers.fixed(r.ai.annualTokensM / 1000, 2)}`, 'B/yr'));
    }

    if (r.electrolyzer.enabled) {
      rows.push(prodItem('h2', '💧', 'Hydrogen', `${FormatNumbers.fixed(r.electrolyzer.h2DailyKg, 1)}`, `kg/${cycleUnit}`));
    }
    if (r.dac.enabled) {
      rows.push(prodItem('co2', '🌬️', 'CO₂ Captured', `${FormatNumbers.fixed(r.dac.co2DailyKg, 1)}`, `kg/${cycleUnit}`));
    }

    if (r.sabatier.enabled) {
      rows.push(prodItem('ch4', '🔥', 'Methane', `${FormatNumbers.fixed(r.sabatier.ch4DailyMCF, 2)}`, `MCF/${cycleUnit}`));
    }
    if (r.methanol.enabled && ((r.methanol.exportDailyKg ?? r.methanol.dailyLiters ?? 0) > 0.1)) {
      rows.push(prodItem('fuel', '🧪', 'Methanol Export', `${FormatNumbers.fixed(r.methanol.dailyLiters, 1)}`, `L/${cycleUnit}`));
    }
    (r.exploratoryModules || [])
      .filter(module => module.enabled && module.outputDailyUnits > 0)
      .forEach(module => {
        const value = module.outputUnit === 'm3'
          ? `${FormatNumbers.fixed(module.outputDailyUnits, module.outputDailyUnits >= 10 ? 0 : 1)}`
          : `${FormatNumbers.fixed(module.outputDailyUnits, module.outputDailyUnits >= 10 ? 0 : 1)}`;
        const unit = module.outputUnit === 'm3' ? `m3/${cycleUnit}` : `t/${cycleUnit}`;
        rows.push(prodItem('electric', '', module.outputLabel || module.label, value, unit));
      });
    if (r.h2Surplus > 0.1) rows.push(prodItem('h2', '💨', 'Unused H₂', `${FormatNumbers.fixed(r.h2Surplus, 1)}`, `kg/${cycleUnit}`));
    if (r.co2Surplus > 0.1) rows.push(prodItem('co2', '☁️', 'CO₂ Surplus', `${FormatNumbers.fixed(r.co2Surplus, 1)}`, `kg/${cycleUnit}`));

    document.getElementById('productionGrid').innerHTML = rows.join('');
  },

  updateEconomics(r) {
    document.getElementById('econBreakdown').innerHTML = renderEconomicsBreakdown(r, {
      state: this.state,
      methaneMarket: this.getMethaneMarketConfig(),
      cycleUnit: this.getCycleRateUnit(r),
    });
  },

  updateImpact(r) {
    const cycleUnit = this.getCycleRateUnit(r);
    const env = r.environmental;
    const html = [
      prodItem('co2', '🌍', 'CO₂ Captured', `${FormatNumbers.fixed(env.co2Captured, 1)}`, 'tons/yr'),
      prodItem('ch4', '♻️', 'CO₂ Displaced', `${FormatNumbers.fixed(env.co2Displaced, 1)}`, 'tons/yr'),
      prodItem('solar', '📐', 'Land Use', `${FormatNumbers.fixed(env.landAcres, 1)}`, 'acres'),
      prodItem('h2', '♻️', 'Water Recycled', `${FormatNumbers.fixed(env.waterRecycledDaily, 0)}`, `L/${cycleUnit}`),
      prodItem('h2', '💧', 'Net Water Needed', `${FormatNumbers.fixed(env.netWaterDaily, 0)}`, `L/${cycleUnit}`),
    ];
    document.getElementById('impactGrid').innerHTML = html.join('');
  },
};
