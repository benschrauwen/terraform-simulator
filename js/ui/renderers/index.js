/* Result panels attached to App: info read-outs, header metrics, score, production, economics, impact */

import { SolarGeometry } from '../../model/solar-geometry.js';
import { Diagram } from '../diagram.js';
import { FormatNumbers } from '../format-numbers.js';
import { formatIrrWithStatus, formatMirr, formatPowerKW } from '../formatters.js';
import { renderEconomicsBreakdown } from './economics.js';
import { applyTooltip, EDUCATIONAL_TOOLTIPS, escapeAttribute, escapeHtml, prodItem } from './markup.js';

export const rendererMethods = {
  updateInfoDisplays(r) {
    document.getElementById('ghiValue').textContent = `${FormatNumbers.fixed(r.solar.ghi, 0)} kWh/m²/yr`;
    document.getElementById('sunHoursValue').textContent = `${FormatNumbers.fixed(r.solar.sunHours, 1)} ${r.solar.hoursPerCycleLabel}`;
    document.getElementById('baseYieldValue').textContent = `${FormatNumbers.fixed(r.solar.baseYield, 0)} MWh/MWdc-yr`;
    const mountingYieldMultValue = document.getElementById('mountingYieldMultValue');
    if (mountingYieldMultValue) {
      mountingYieldMultValue.textContent = `${FormatNumbers.fixed(r.solar.yieldMult, 3)}× vs ${r.solar.baseYieldReference}`;
    }
    const solarYieldWarning = document.getElementById('solarYieldWarning');
    if (solarYieldWarning) {
      const messages = (r.warnings || []).map(warning => warning.message);
      solarYieldWarning.textContent = messages.join(' ');
      solarYieldWarning.hidden = messages.length === 0;
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
    // Always the chemical plant's own utilization and dispatch operating
    // hours. The solar capacity factor and day length are different
    // quantities (energy / array nameplate; sunrise to sunset) even when
    // the plant clips nothing.
    const displayedCf = r.chemicalSupply.effectiveCF;
    const displayedHours = r.chemicalSupply.dailyOpHours;
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
      aiDesignLoadValue.textContent = r.ai.enabled ? formatPowerKW(r.ai.designLoadKW) : 'Off';
    }
    const fixedLoad = r.ai.enabled && r.ai.sizingMode === 'fixed';
    const aiDesignLoadLabel = document.getElementById('aiDesignLoadLabel');
    if (aiDesignLoadLabel) {
      aiDesignLoadLabel.textContent = fixedLoad ? 'Set GPU IT load:' : 'Auto-sized AI load:';
      applyTooltip(
        aiDesignLoadLabel,
        fixedLoad
          ? 'Constant GPU IT load you set; the battery is auto-sized to keep it at the reliability target.'
          : 'AI load size the current solar-plus-battery system can support at the selected reliability target.'
      );
    }
    const aiSizedBatteryRow = document.getElementById('aiSizedBatteryRow');
    const aiSizedBatteryValue = document.getElementById('aiSizedBatteryValue');
    if (aiSizedBatteryRow) aiSizedBatteryRow.hidden = !fixedLoad;
    if (aiSizedBatteryValue) {
      const sizing = fixedLoad ? r.ai.batterySizing : null;
      aiSizedBatteryValue.textContent = sizing
        ? `${FormatNumbers.fixed(sizing.batteryMWh, 2)} MWh (${FormatNumbers.fixed(sizing.loadKW > 0 ? (sizing.batteryMWh * 1000) / sizing.loadKW : 0, 1)} h of IT load)${sizing.feasible ? '' : ', capped'}`
        : '—';
    }
    const aiEnergySplitValue = document.getElementById('aiEnergySplitValue');
    if (aiEnergySplitValue) {
      const solarKWh = r.annualDispatch?.solarKWh || 0;
      aiEnergySplitValue.textContent = r.ai.enabled && solarKWh > 0
        ? `${FormatNumbers.fixed((r.annualDispatch.aiServedKWh / solarKWh) * 100, 1)}% / ${FormatNumbers.fixed((r.annualDispatch.chemicalKWh / solarKWh) * 100, 1)}% (${FormatNumbers.fixed(r.ai.annualAiServedKWh / 1000, 0)} / ${FormatNumbers.fixed(r.ai.chemicalAnnualKWh / 1000, 0)} MWh/yr)`
        : '—';
    }
    if (aiUtilizationValue) {
      aiUtilizationValue.textContent = r.ai.enabled ? `${FormatNumbers.fixed(r.ai.utilization * 100, 2)}%` : '—';
    }
    if (aiFullRateValue) {
      aiFullRateValue.textContent = r.ai.enabled ? `${FormatNumbers.fixed(r.ai.fullPowerReliability * 100, 2)}%` : '—';
    }
    const aiLateLifeReliabilityValue = document.getElementById('aiLateLifeReliabilityValue');
    if (aiLateLifeReliabilityValue) {
      aiLateLifeReliabilityValue.textContent = r.ai.enabled && Number.isFinite(r.ai.lateLifeReliability)
        ? `${FormatNumbers.fixed(r.ai.lateLifeReliability * 100, 2)}% (year ${FormatNumbers.fixed(r.ai.lateLifeReliabilityYear, 0)}, PV at ${FormatNumbers.fixed(r.ai.lateLifeSolarFactor * 100, 1)}%)`
        : '—';
    }
    const aiBatterySeedNote = document.getElementById('aiBatterySeedNote');
    if (aiBatterySeedNote) {
      const seededMWh = r.ai.enabled ? (r.ai.batterySeededMWh || 0) : 0;
      aiBatterySeedNote.textContent = seededMWh > 0
        ? `The ${FormatNumbers.fixed(seededMWh, 1)} MWh battery was added automatically for AI sizing (1 MWh per GWh/yr of solar); change it under Battery Storage.`
        : '';
      aiBatterySeedNote.hidden = !(seededMWh > 0);
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
    document.getElementById('metricPayback').textContent = e.noNetInvestment
      ? 'n/a (no net investment)'
      : Number.isFinite(e.paybackYears) ? `${FormatNumbers.fixed(e.paybackYears, 1)} yrs` : 'Not within horizon';
    const irrLabel = document.getElementById('metricIrrLabel');
    const irrAnalysis = e.financing.enabled ? e.equityIrrAnalysis : e.projectIrrAnalysis;
    const irrAvailable = Number.isFinite(e.irr);
    if (irrLabel) {
      irrLabel.textContent = e.financing.enabled ? 'Equity IRR' : 'IRR';
      const baseTooltip = e.financing.enabled ? EDUCATIONAL_TOOLTIPS.equityIrr : EDUCATIONAL_TOOLTIPS.projectIrr;
      applyTooltip(
        irrLabel,
        `${irrAvailable ? '' : `${irrAnalysis?.reason || ''} `}${baseTooltip} MIRR at the discount rate: ${formatMirr(e.mirr)}.`
      );
    }
    // Without a single meaningful IRR the header shows the verdict and MIRR.
    document.getElementById('metricIRR').textContent = irrAvailable
      ? formatIrrWithStatus(e.irr, irrAnalysis)
      : `n/a · MIRR ${formatMirr(e.mirr)}`;

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
      financingTermCapValue.textContent = !e.financing.enabled
        ? `Up to 30 years; a term past the ${FormatNumbers.fixed(analysisHorizonYears, 0)}-year horizon ends in a balloon repayment`
        : e.financing.termExceedsHorizon
          ? `${FormatNumbers.fixed(e.financing.debtTermYears, 0)}-year term past the ${FormatNumbers.fixed(analysisHorizonYears, 0)}-year analysis: ${FormatNumbers.formatMoney(e.financing.balloonPayment)} balloon in year ${FormatNumbers.fixed(analysisHorizonYears, 0)}`
          : `${FormatNumbers.fixed(e.financing.debtTermYears, 0)}-year debt term within ${FormatNumbers.fixed(analysisHorizonYears, 0)}-year analysis`;
    }

    const viability = document.getElementById('metricViability');
    const label = document.getElementById('metricViabilityValue');
    viability.classList.remove('viable', 'marginal', 'not-viable');

    // Payback excludes salvage, so "Viable" needs operating cash to recover
    // the outlay inside the horizon; a positive NPV carried only by the
    // final-year book value is "Marginal" at best.
    const recovered = Number.isFinite(e.paybackYears) && e.paybackYears <= this.state.analysisHorizonYears;
    if (e.npv > 0 && recovered) {
      viability.classList.add('viable');
      label.textContent = 'Viable';
    } else if (e.npv > 0 || recovered) {
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

    const cf = r.chemicalSupply.effectiveCF;
    score += cf * 18;
    if (cf > 0.22) badges.push({ text: 'High Utilization', cls: 'blue' });

    const h2Util = r.electrolyzer.enabled && r.electrolyzer.h2DailyKg > 0
      ? 1 - (r.h2Surplus / r.electrolyzer.h2DailyKg)
      : 0;
    score += Math.max(0, h2Util) * 10;
    if (h2Util > 0.9) badges.push({ text: 'Balanced Feeds', cls: 'green' });

    // Average reactor load while running, as a share of its design rate
    // (designHourlyRate is an absolute MCF/h, so it scaled with plant size).
    if (r.sabatier.enabled && (r.sabatier.operatingUtilization || 0) >= 0.8) {
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
      .map(badge => `<span class="badge ${escapeAttribute(badge.cls)}">${escapeHtml(badge.text)}</span>`)
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
      prodItem('solar', 'Electricity', `${FormatNumbers.fixed(r.solar.annualMWh, 0)}`, 'MWh/yr'),
    ];

    if (r.ai.enabled) {
      rows.push(prodItem('electric', 'AI Tokens', `${FormatNumbers.fixed(r.ai.annualTokensM / 1000, 2)}`, 'B/yr'));
    }

    if (r.electrolyzer.enabled) {
      rows.push(prodItem('h2', 'Hydrogen', `${FormatNumbers.fixed(r.electrolyzer.h2DailyKg, 1)}`, `kg/${cycleUnit}`));
    }
    if (r.dac.enabled) {
      rows.push(prodItem('co2', 'CO₂ Captured', `${FormatNumbers.fixed(r.dac.co2DailyKg, 1)}`, `kg/${cycleUnit}`));
    }

    if (r.sabatier.enabled) {
      rows.push(prodItem('ch4', 'Methane', `${FormatNumbers.fixed(r.sabatier.ch4DailyMCF, 2)}`, `MCF/${cycleUnit}`));
    }
    if (r.methanol.enabled && r.methanol.exportDailyKg > 0.1) {
      rows.push(prodItem('fuel', 'Methanol Export', `${FormatNumbers.fixed(r.methanol.dailyLiters, 1)}`, `L/${cycleUnit}`));
    }
    (r.exploratoryModules || [])
      .filter(module => module.enabled && module.outputDailyUnits > 0)
      .forEach(module => {
        const value = FormatNumbers.fixed(module.outputDailyUnits, module.outputDailyUnits >= 10 ? 0 : 1);
        const unit = module.outputUnit === 'm3' ? `m3/${cycleUnit}` : `t/${cycleUnit}`;
        rows.push(prodItem('electric', module.outputLabel || module.label, value, unit));
      });
    if (r.h2Surplus > 0.1) rows.push(prodItem('h2', 'Unused H₂', `${FormatNumbers.fixed(r.h2Surplus, 1)}`, `kg/${cycleUnit}`));
    if (r.co2Surplus > 0.1) rows.push(prodItem('co2', 'CO₂ Surplus', `${FormatNumbers.fixed(r.co2Surplus, 1)}`, `kg/${cycleUnit}`));

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
      prodItem('co2', 'CO₂ Captured', `${FormatNumbers.fixed(env.co2Captured, 1)}`, 't/yr'),
      prodItem('co2', 'CO₂ Bound in Products', `${FormatNumbers.fixed(env.co2BoundInProducts, 1)}`, 't/yr'),
      prodItem('co2', 'CO₂ Vented', `${FormatNumbers.fixed(env.co2Vented, 1)}`, 't/yr'),
      prodItem('ch4', 'Net CO₂ Avoided (fossil fuel displaced)', `${FormatNumbers.fixed(env.co2NetAvoided, 1)}`, 't/yr'),
      prodItem('solar', 'Land Use', `${FormatNumbers.fixed(env.landAcres, 1)}`, 'acres'),
      prodItem('h2', 'Water Recycled', `${FormatNumbers.fixed(env.waterRecycledDaily, 0)}`, `L/${cycleUnit}`),
      prodItem('h2', 'Net Water Needed (incl. ~25% purification rejects)', `${FormatNumbers.fixed(env.netWaterDaily, 0)}`, `L/${cycleUnit}`),
    ];
    document.getElementById('impactGrid').innerHTML = html.join('');
  },
};
