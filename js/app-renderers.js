/* Rendering helpers attached to App */

window.AppRendererMethods = {
  updateInfoDisplays(r) {
    document.getElementById('ghiValue').textContent = `${FormatNumbers.fixed(r.solar.ghi, 0)} kWh/m²/yr`;
    document.getElementById('sunHoursValue').textContent = `${FormatNumbers.fixed(r.solar.sunHours, 1)} ${r.solar.hoursPerCycleLabel}`;
    document.getElementById('baseYieldValue').textContent = `${FormatNumbers.fixed(r.solar.baseYield, 0)} MWh/MWdc-yr`;
    document.getElementById('annualProduction').textContent = `${FormatNumbers.fixed(r.solar.annualMWh, 0)} MWh`;
    document.getElementById('capacityFactor').textContent = `${FormatNumbers.fixed(r.solar.capacityFactor * 100, 1)}%`;
    document.getElementById('lcoe').textContent = `$${FormatNumbers.fixed(r.solar.lcoe, 2)}/MWh`;
    const solarInstallCapex = document.getElementById('solarInstallCapex');
    if (solarInstallCapex) {
      solarInstallCapex.textContent = this.formatMoney(r.solar.totalSolarCapex);
    }

    const effectiveCfLabel = document.getElementById('effectiveCFLabel');
    if (effectiveCfLabel) effectiveCfLabel.textContent = r.ai.enabled ? 'Residual Chem CF:' : 'Effective CF:';
    const dailyOpHoursLabel = document.getElementById('dailyOpHoursLabel');
    if (dailyOpHoursLabel && r.ai.enabled) {
      dailyOpHoursLabel.textContent = r.solar.bodyKey === 'earth' ? 'Residual Chem Hrs/Day:' : 'Residual Chem Hrs/Cycle:';
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

    const aiDesignLoadValue = document.getElementById('aiDesignLoadValue');
    const aiUtilizationValue = document.getElementById('aiUtilizationValue');
    const aiFullRateValue = document.getElementById('aiFullRateValue');
    const aiTokensAnnualValue = document.getElementById('aiTokensAnnualValue');
    if (aiDesignLoadValue) {
      aiDesignLoadValue.textContent = r.ai.enabled ? this.formatSystemSizeMW(r.ai.designLoadKW / 1000) : 'Off';
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
    document.getElementById('metricCapex').textContent = this.formatMoney(e.totalCapex);
    document.getElementById('metricRevenue').textContent = `${this.formatMoney(e.totalAnnualRevenue)}/yr`;
    document.getElementById('metricPayback').textContent = Number.isFinite(e.paybackYears) ? `${FormatNumbers.fixed(e.paybackYears, 1)} yrs` : 'No payback';
    const irrLabel = document.getElementById('metricIrrLabel');
    if (irrLabel) irrLabel.textContent = e.financing.enabled ? 'Equity IRR' : 'IRR';
    document.getElementById('metricIRR').textContent = this.formatIrr(e.irr);

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
      this.prodItem('solar', '☀️', 'Electricity', `${FormatNumbers.fixed(r.solar.annualMWh, 0)}`, 'MWh/yr'),
    ];

    if (r.ai.enabled) {
      rows.push(this.prodItem('electric', '🧠', 'AI Tokens', `${FormatNumbers.fixed(r.ai.annualTokensM / 1000, 2)}`, 'B/yr'));
    }

    if (r.electrolyzer.enabled) {
      rows.push(this.prodItem('h2', '💧', 'Hydrogen', `${FormatNumbers.fixed(r.electrolyzer.h2DailyKg, 1)}`, `kg/${cycleUnit}`));
    }
    if (r.dac.enabled) {
      rows.push(this.prodItem('co2', '🌬️', 'CO₂ Captured', `${FormatNumbers.fixed(r.dac.co2DailyKg, 1)}`, `kg/${cycleUnit}`));
    }

    if (r.sabatier.enabled) {
      rows.push(this.prodItem('ch4', '🔥', 'Methane', `${FormatNumbers.fixed(r.sabatier.ch4DailyMCF, 2)}`, `MCF/${cycleUnit}`));
    }
    if (r.methanol.enabled && ((r.methanol.exportDailyKg ?? r.methanol.dailyLiters ?? 0) > 0.1)) {
      rows.push(this.prodItem('fuel', '🧪', 'Methanol Export', `${FormatNumbers.fixed(r.methanol.dailyLiters, 1)}`, `L/${cycleUnit}`));
    }
    (r.exploratoryModules || [])
      .filter(module => module.enabled && module.outputDailyUnits > 0)
      .forEach(module => {
        const value = module.outputUnit === 'm3'
          ? `${FormatNumbers.fixed(module.outputDailyUnits, module.outputDailyUnits >= 10 ? 0 : 1)}`
          : `${FormatNumbers.fixed(module.outputDailyUnits, module.outputDailyUnits >= 10 ? 0 : 1)}`;
        const unit = module.outputUnit === 'm3' ? `m3/${cycleUnit}` : `t/${cycleUnit}`;
        rows.push(this.prodItem('electric', '', module.outputLabel || module.label, value, unit));
      });
    if (r.h2Surplus > 0.1) rows.push(this.prodItem('h2', '💨', 'Unused H₂', `${FormatNumbers.fixed(r.h2Surplus, 1)}`, `kg/${cycleUnit}`));
    if (r.co2Surplus > 0.1) rows.push(this.prodItem('co2', '☁️', 'CO₂ Surplus', `${FormatNumbers.fixed(r.co2Surplus, 1)}`, `kg/${cycleUnit}`));

    document.getElementById('productionGrid').innerHTML = rows.join('');
  },

  prodItem(cls, _icon, label, value, unit) {
    const unitMarkup = unit ? `<span class="prod-unit">${unit}</span>` : '';
    return `<div class="production-item ${cls}">
      <span class="prod-label"><span class="prod-dot" aria-hidden="true"></span>${label}</span>
      <span class="prod-value">${value}${unitMarkup}</span>
    </div>`;
  },

  updateEconomics(r) {
    const e = r.economics;
    const solarBreakdown = e.capexBreakdown || {};
    const methaneMarket = this.getMethaneMarketConfig();
    const projectNpvLabel = e.financing.enabled ? 'Project NPV' : 'NPV';
    const projectIrrLabel = e.financing.enabled ? 'Project IRR' : 'IRR';
    const projectPaybackLabel = e.financing.enabled ? 'Project payback' : 'Payback';
    const formatPaybackShort = years => (Number.isFinite(years) ? `${FormatNumbers.fixed(years, 1)} yrs` : 'N/A');
    const formatPaybackLong = years => (Number.isFinite(years) ? `${FormatNumbers.fixed(years, 1)} years` : 'N/A');
    const summaryMetrics = [];
    const returnsRows = [];
    const costRows = [];
    const revenueRows = [];
    const financingRows = [];
    const unitRows = [];
    const contextRows = [];
    const econMetric = (...args) => window.AppRendererMethods.econMetric(...args);
    const econGroup = (...args) => window.AppRendererMethods.econGroup(...args);

    summaryMetrics.push(
      econMetric('Total CAPEX', this.formatMoney(e.totalCapex), '', 'Installed build cost'),
      econMetric(
        'Annual revenue',
        this.formatMoney(e.totalAnnualRevenue),
        e.totalAnnualRevenue >= 0 ? 'positive' : 'negative',
        'Product sales plus any annual operating support'
      ),
      econMetric('Levelized cost', this.formatMoney(e.annualCost), 'negative', 'CRF capital + O&M'),
      econMetric('Annual profit', this.formatMoney(e.annualProfit), e.annualProfit >= 0 ? 'positive' : 'negative', 'Revenue minus levelized cost'),
      econMetric(
        projectNpvLabel,
        this.formatMoney(e.npv),
        e.npv >= 0 ? 'positive' : 'negative',
        e.totalReplacementOutflows > 0
          ? `Includes ${this.formatMoney(e.totalReplacementOutflows)} replacements`
          : 'Discounted project cash flow'
      ),
      econMetric(
        projectIrrLabel,
        this.formatIrr(e.projectIrr),
        Number.isFinite(e.projectIrr) ? (e.projectIrr >= 0 ? 'positive' : 'negative') : '',
        `${projectPaybackLabel}: ${formatPaybackShort(e.paybackYears)}`
      )
    );

    if (e.financing.enabled) {
      summaryMetrics.push(
        econMetric(
          'Equity IRR',
          this.formatIrr(e.equityIrr),
          Number.isFinite(e.equityIrr) ? (e.equityIrr >= 0 ? 'positive' : 'negative') : '',
          `Equity payback: ${formatPaybackShort(e.equityPaybackYears)}`
        )
      );
    }

    returnsRows.push(
      this.econRow(
        'Annual profit (levelized)',
        this.formatMoney(e.annualProfit),
        e.annualProfit >= 0 ? 'positive' : 'negative',
        'Revenue minus total levelized annual cost (capital recovery + O&M).'
      ),
      this.econRow(
        projectNpvLabel,
        this.formatMoney(e.npv),
        e.npv >= 0 ? 'positive' : 'negative',
        'Discounted cash flows: gross upfront CAPEX less any close-date policy support in year 0, then yearly revenue minus O&M and any scheduled replacement CAPEX. CRF capital recovery is not repeated as a cash outflow.'
      ),
      this.econRow(
        projectIrrLabel,
        this.formatIrr(e.projectIrr),
        Number.isFinite(e.projectIrr) ? (e.projectIrr >= 0 ? 'positive' : 'negative') : '',
        'Internal rate of return on the same net-cash path as NPV after O&M, close-date policy support, and scheduled replacements.'
      )
    );

    if (e.financing.enabled) {
      returnsRows.push(
        this.econRow(
          'Equity IRR',
          this.formatIrr(e.equityIrr),
          Number.isFinite(e.equityIrr) ? (e.equityIrr >= 0 ? 'positive' : 'negative') : '',
          'IRR on sponsor equity cash flows: upfront equity plus financing fees in year 0, then project net cash after scheduled debt service.'
        )
      );
    }

    returnsRows.push(
      this.econRow(
        projectPaybackLabel,
        formatPaybackLong(e.paybackYears),
        '',
        'Simple payback on cumulative net cash versus upfront CAPEX. This is the first point where cumulative net cash turns positive.'
      )
    );
    const sustainedProjectPaybackLabel = e.financing.enabled ? 'Sustained project payback' : 'Sustained payback';
    const showSustainedProjectPayback = Number.isFinite(e.sustainedPaybackYears)
      ? Math.abs(e.sustainedPaybackYears - e.paybackYears) > 1e-6
      : Number.isFinite(e.paybackYears);
    if (showSustainedProjectPayback) {
      returnsRows.push(
        this.econRow(
          sustainedProjectPaybackLabel,
          formatPaybackLong(e.sustainedPaybackYears),
          '',
          'Payback only if the project stays cumulative-cash positive through the full selected horizon after scheduled replacements.'
        )
      );
    }
    if (e.financing.enabled) {
      returnsRows.push(
        this.econRow(
          'Equity payback',
          formatPaybackLong(e.equityPaybackYears),
          '',
          'Simple payback on cumulative sponsor equity cash after scheduled debt service.'
        )
      );
      const showSustainedEquityPayback = Number.isFinite(e.sustainedEquityPaybackYears)
        ? Math.abs(e.sustainedEquityPaybackYears - e.equityPaybackYears) > 1e-6
        : Number.isFinite(e.equityPaybackYears);
      if (showSustainedEquityPayback) {
        returnsRows.push(
          this.econRow(
            'Sustained equity payback',
            formatPaybackLong(e.sustainedEquityPaybackYears),
            '',
            'Equity payback only if sponsor cash stays cumulative-positive through the full selected horizon after debt service and replacements.'
          )
        );
      }
    }
    if (e.totalReplacementOutflows > 0) {
      returnsRows.push(
        this.econRow(
          'Scheduled replacements',
          this.formatMoney(e.totalReplacementOutflows),
          'negative',
          'Full equipment replacement CAPEX that lands inside the selected analysis horizon and is included in NPV, IRR, ROI, and payback.'
        )
      );
    }

    costRows.push(
      this.econRow('Annualized cost build', '', 'header'),
      this.econRow(
        'Capital recovery',
        this.formatMoney(e.annualizedCapexTotal),
        'negative',
        `Upfront CAPEX x capital recovery factor at ${FormatNumbers.fixed(this.state.discountRate, 1)}% and each asset's book life. This is the economic annual capital charge, not straight-line depreciation.`
      )
    );
    if (r.ai.enabled && r.ai.annualOM > 0) {
      costRows.push(this.econRow('AI fixed O&M', this.formatMoney(r.ai.annualOM), 'negative'));
    }
    (e.exploratoryDetails || []).forEach(module => {
      if (module.annualOM <= 0) return;
      costRows.push(this.econRow(`${module.label} O&M`, this.formatMoney(module.annualOM), 'negative'));
    });
    costRows.push(
      this.econRow('Total O&M', this.formatMoney(e.annualOM), 'negative'),
      this.econRow('Total levelized annual cost', this.formatMoney(e.annualCost), 'total')
    );

    costRows.push(
      this.econRow('Installed CAPEX', '', 'header'),
      this.econRow('Solar modules', this.formatMoney(solarBreakdown.solarModules || 0)),
      this.econRow('Solar structure + install BOS', this.formatMoney(solarBreakdown.solarBos || 0))
    );
    if ((solarBreakdown.solarLand || 0) > 0) costRows.push(this.econRow('Land acquisition', this.formatMoney(solarBreakdown.solarLand)));
    if ((solarBreakdown.solarSitePrep || 0) > 0) costRows.push(this.econRow('Site prep', this.formatMoney(solarBreakdown.solarSitePrep)));
    costRows.push(this.econRow('Total solar installation', this.formatMoney(e.capex.solar)));
    if (e.capex.battery > 0) costRows.push(this.econRow('Battery', this.formatMoney(e.capex.battery)));
    if (e.capex.ai > 0) costRows.push(this.econRow('AI datacenter', this.formatMoney(e.capex.ai)));
    if (e.capex.electrolyzer > 0) costRows.push(this.econRow('Electrolyzer', this.formatMoney(e.capex.electrolyzer)));
    if (e.capex.dac > 0) costRows.push(this.econRow('DAC', this.formatMoney(e.capex.dac)));
    if (e.capex.sabatier > 0) costRows.push(this.econRow('Methane reactor', this.formatMoney(e.capex.sabatier)));
    if (e.capex.methanol > 0) costRows.push(this.econRow('Methanol reactor', this.formatMoney(e.capex.methanol)));
    (e.exploratoryDetails || []).forEach(module => {
      if (module.capex <= 0) return;
      costRows.push(this.econRow(`${module.label} (${module.routeLabel})`, this.formatMoney(module.capex)));
    });
    costRows.push(this.econRow('Total CAPEX', this.formatMoney(e.totalCapex), 'total'));
    if (Math.abs(e.policy.upfrontSupport || 0) > 1e-9) {
      costRows.push(
        this.econRow(
          'Upfront incentive support',
          this.formatMoney(e.policy.upfrontSupport),
          'positive',
          'Applied at close as a reduction to eligible upfront CAPEX only. Replacement CAPEX later in life is not automatically subsidized in the current model.'
        ),
        this.econRow('Net CAPEX at close', this.formatMoney(e.netCapexAtClose), 'total')
      );
    }

    if (e.revenue.ai > 0) revenueRows.push(this.econRow('AI token revenue', this.formatMoney(e.revenue.ai), 'positive'));
    if (e.revenue.methane > 0) {
      revenueRows.push(
        this.econRow(`Methane sales @ $${FormatNumbers.fixed(e.methaneSalePrice, 2)}/MCF`, this.formatMoney(e.revenue.methane), 'positive')
      );
    }
    if (e.revenue.methanol > 0) revenueRows.push(this.econRow('Methanol sales', this.formatMoney(e.revenue.methanol), 'positive'));
    (e.exploratoryDetails || []).forEach(module => {
      if (module.annualRevenue <= 0) return;
      const priceDigits = module.outputUnit === 'm3' ? 2 : 0;
      const unitSuffix = module.outputUnit === 'm3' ? 'm3' : 'ton';
      revenueRows.push(
        this.econRow(
          `${module.label} sales @ $${FormatNumbers.fixed(module.unitPrice, priceDigits)}/${unitSuffix}`,
          this.formatMoney(module.annualRevenue),
          'positive'
        )
      );
    });
    if (Math.abs(e.revenue.policyCredits || 0) > 1e-9) {
      revenueRows.push(
        this.econRow(
          e.policy.label,
          this.formatMoney(e.revenue.policyCredits),
          e.revenue.policyCredits >= 0 ? 'positive' : 'negative'
        )
      );
    }
    revenueRows.push(this.econRow('Total revenue', this.formatMoney(e.totalAnnualRevenue), 'total'));

    if (e.financing.enabled) {
      financingRows.push(
        this.econRow('Debt share', `${FormatNumbers.fixed(e.financing.debtSharePercent, 0)}% of upfront CAPEX`),
        this.econRow('Debt-funded at close', this.formatMoney(e.financing.debtAmount), 'positive'),
        this.econRow('Equity-funded CAPEX', this.formatMoney(e.financing.equityCapex), 'negative')
      );
      if (e.financing.upfrontFee > 0) {
        financingRows.push(this.econRow('Upfront financing fee', this.formatMoney(e.financing.upfrontFee), 'negative'));
      }
      financingRows.push(
        this.econRow('Total sponsor cash at close', this.formatMoney(e.financing.equityUpfront), 'negative'),
        this.econRow('Debt coupon', `${FormatNumbers.fixed(e.financing.debtInterestRate, 2)}%`),
        this.econRow('Debt term', `${FormatNumbers.fixed(e.financing.debtTermYears, 0)} years`)
      );
      if (e.financing.totalDebtService > 0) {
        financingRows.push(
          this.econRow(
            'Annual debt service',
            this.formatMoney(e.financing.annualDebtService),
            'negative',
            'Modeled as a level-payment amortizing loan over the selected debt term.'
          ),
          this.econRow('Total debt interest', this.formatMoney(e.financing.totalInterest), 'negative')
        );
      }
      if (!e.financing.canFullyCoverDebtService && e.financing.sponsorSupportTotal > 0) {
        const uncoveredYearsLabel = e.financing.uncoveredDebtServiceYearCount === 1
          ? '1 year'
          : `${FormatNumbers.fixed(e.financing.uncoveredDebtServiceYearCount, 0)} years`;
        const peakSupportLabel = e.financing.peakSponsorSupportYear
          ? `${this.formatMoney(e.financing.peakSponsorSupport)} in year ${FormatNumbers.fixed(e.financing.peakSponsorSupportYear, 0)}`
          : this.formatMoney(e.financing.peakSponsorSupport);
        financingRows.push(
          this.econRow(
            'Financing warning',
            `Debt service exceeds operating cash flow in ${uncoveredYearsLabel}`,
            'warning',
            'The model does not default or restructure the debt. It assumes the sponsor contributes extra cash whenever scheduled debt service is higher than project operating cash flow.'
          ),
          this.econRow(
            'Additional sponsor cash support',
            this.formatMoney(e.financing.sponsorSupportTotal),
            'warning',
            'Total additional sponsor cash assumed to cover debt-service shortfalls after O&M over the selected analysis horizon.'
          ),
          this.econRow(
            'Peak annual sponsor support',
            peakSupportLabel,
            'warning',
            'Largest single-year sponsor cash support needed because debt service is higher than project operating cash flow.'
          )
        );
      }
    }

    if (r.ai.enabled) {
      unitRows.push(
        this.econRow('Integrated AI cost', `$${FormatNumbers.fixed(e.costPerMToken, 2)} / 1M tokens`),
        this.econRow(
          'Token margin',
          `${e.tokenMarginPerM >= 0 ? '+' : ''}$${FormatNumbers.fixed(e.tokenMarginPerM, 2)} / 1M`,
          e.tokenMarginPerM >= 0 ? 'positive' : 'negative'
        )
      );
    }
    if (e.costPerKgH2 > 0) unitRows.push(this.econRow('Integrated H₂ cost', `$${FormatNumbers.fixed(e.costPerKgH2, 2)}/kg`));
    if (e.costPerTonCO2 > 0) unitRows.push(this.econRow('Integrated CO₂ cost', `$${FormatNumbers.fixed(e.costPerTonCO2, 0)}/ton`));
    if (e.costPerMCF > 0) unitRows.push(this.econRow('Integrated CH₄ cost', `$${FormatNumbers.fixed(e.costPerMCF, 2)}/MCF`));

    if (e.revenue.ai > 0) {
      contextRows.push(
        this.econRow('AI token price', `$${FormatNumbers.fixed(this.state.aiTokenPricePerM, 2)} / 1M tokens`),
        this.econRow('AI throughput', `${Math.round(this.state.aiMillionTokensPerMWh).toLocaleString()} M tokens/MWh`),
        this.econRow('AI tokens sold', `${FormatNumbers.fixed(r.ai.annualTokensM / 1000, 2)}B /yr`),
        this.econRow('AI load auto-sized', this.formatSystemSizeMW(r.ai.designLoadKW / 1000)),
        this.econRow('Served-energy utilization', `${FormatNumbers.fixed(r.ai.utilization * 100, 2)}%`),
        this.econRow('Full-rate reliability', `${FormatNumbers.fixed(r.ai.fullPowerReliability * 100, 2)}%`)
      );
    }
    if (e.revenue.methane > 0) {
      contextRows.push(this.econRow('Methane market', methaneMarket.applicability));
    }
    if (e.policy.mode !== 'none') {
      contextRows.push(
        this.econRow('Incentive scheme', e.policy.label),
        this.econRow('Policy scope', e.policy.applicability),
        this.econRow('Model treatment', String(e.policy.simulatorTreatment || '').replace(/_/g, ' ')),
        this.econRow('Support family', e.policy.supportFamilyLabel)
      );
      if (Number.isFinite(e.policy.durationYears)) {
        contextRows.push(this.econRow('Policy duration', `${FormatNumbers.fixed(e.policy.durationYears, 0)} years`));
      }
      if ((e.policy.outputMetric?.value || 0) > 0 && e.policy.outputMetric?.unit) {
        const digits = e.policy.outputMetric.unit === 'MWh/yr' ? 1 : 0;
        contextRows.push(
          this.econRow(
            e.policy.outputMetric.label,
            `${FormatNumbers.fixed(e.policy.outputMetric.value, digits)} ${e.policy.outputMetric.unit}`
          )
        );
      }
      if ((e.policy.eligibleCapex || 0) > 0) {
        contextRows.push(this.econRow(e.policy.eligibleCapexLabel, this.formatMoney(e.policy.eligibleCapex)));
      }
      if (Math.abs(e.policy.upfrontSupport || 0) > 1e-9) {
        contextRows.push(this.econRow('Upfront support at close', this.formatMoney(e.policy.upfrontSupport), 'positive'));
      }
      (e.policy.inputValues || []).forEach(input => {
        contextRows.push(this.econRow(input.label, input.formattedValue));
      });
      if (e.policy.referencePriceRequired) {
        contextRows.push(this.econRow('Reference price required', 'Yes'));
      }
    }
    if (r.h2Surplus > 0.1) {
      contextRows.push(this.econRow('Unused H₂', `${FormatNumbers.fixed(r.h2Surplus, 1)} kg/${this.getCycleRateUnit(r)}`));
    }
    if (r.co2Surplus > 0.1) {
      contextRows.push(this.econRow('Unused CO₂', `${FormatNumbers.fixed(r.co2Surplus, 1)} kg/${this.getCycleRateUnit(r)}`));
    }
    if (e.modeledExploratoryModules.length) {
      contextRows.push(this.econRow('Exploratory routes modeled', e.modeledExploratoryModules.join(', ')));
      if (e.exploratoryDetails.length) {
        contextRows.push(
          this.econRow(
            'Exploratory M&O',
            `${FormatNumbers.fixed(e.exploratoryDetails[0].omPercent, 1)}% CAPEX/yr`
          )
        );
      }
      e.exploratoryDetails.forEach(module => {
        const priceDigits = module.outputUnit === 'm3' ? 2 : 0;
        const unitSuffix = module.outputUnit === 'm3' ? 'm3' : 'ton';
        const volumeDigits = module.outputUnit === 'm3' ? 0 : 1;
        contextRows.push(
          this.econRow(`${module.label} price`, `$${FormatNumbers.fixed(module.unitPrice, priceDigits)}/${unitSuffix}`),
          this.econRow(
            `${module.label} CAPEX basis`,
            `$${FormatNumbers.fixed(module.capexBasis, 0)}/${module.capexBasisUnit === 'm3pd' ? 'm3/day' : 'ton/yr capacity'}`
          ),
          this.econRow(
            `${module.label} output`,
            `${FormatNumbers.fixed(module.annualOutputUnits, volumeDigits)} ${module.outputUnit}/yr`
          )
        );
      });
    }

    let html = `<div class="econ-summary-grid">${summaryMetrics.join('')}</div>`;
    html += econGroup(
      'Project returns',
      `${projectIrrLabel} ${this.formatIrr(e.projectIrr)}`,
      returnsRows.join(''),
      'Discounted returns and payback metrics'
    );
    html += econGroup(
      'Cost breakdown',
      `${this.formatMoney(e.annualCost)} /yr`,
      costRows.join(''),
      'Annualized cost stack and installed CAPEX'
    );
    html += econGroup(
      'Revenue breakdown',
      `${this.formatMoney(e.totalAnnualRevenue)} /yr`,
      revenueRows.join(''),
      'Annual revenue sources by product and operating-support regime'
    );
    if (financingRows.length) {
      const financingSummary = (!e.financing.canFullyCoverDebtService && e.financing.sponsorSupportTotal > 0)
        ? `${FormatNumbers.fixed(e.financing.debtSharePercent, 0)}% debt + sponsor support`
        : `${FormatNumbers.fixed(e.financing.debtSharePercent, 0)}% debt`;
      html += econGroup(
        'Financing details',
        financingSummary,
        financingRows.join(''),
        'Sponsor cash needs and debt service'
      );
    }
    if (unitRows.length) {
      const unitSummary = r.ai.enabled
        ? `$${FormatNumbers.fixed(e.costPerMToken, 2)} / 1M tokens`
        : e.costPerMCF > 0
          ? `$${FormatNumbers.fixed(e.costPerMCF, 2)}/MCF`
          : e.costPerKgH2 > 0
            ? `$${FormatNumbers.fixed(e.costPerKgH2, 2)}/kg H₂`
            : e.costPerTonCO2 > 0
              ? `$${FormatNumbers.fixed(e.costPerTonCO2, 0)}/ton CO₂`
              : 'Per-unit costs';
      html += econGroup(
        'Unit economics',
        unitSummary,
        unitRows.join(''),
        'Integrated cost and margin metrics'
      );
    }
    if (contextRows.length) {
      const contextSummary = e.modeledExploratoryModules.length
        ? 'Assumptions + modeled routes'
        : 'Assumptions + losses';
      html += econGroup(
        'Context & routes',
        contextSummary,
        contextRows.join(''),
        'Supporting assumptions behind the headline numbers'
      );
    }

    document.getElementById('econBreakdown').innerHTML = html;
  },

  econMetric(label, value, cls = '', note = '', title = '') {
    const safeTitle = title
      ? ` title="${String(title).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
      : '';
    const noteMarkup = note ? `<span class="econ-metric-note">${note}</span>` : '';
    return `<div class="econ-metric ${cls}"${safeTitle}>
      <span class="econ-metric-label">${label}</span>
      <span class="econ-metric-value">${value}</span>
      ${noteMarkup}
    </div>`;
  },

  econGroup(title, summary, rowsHtml, hint = '') {
    const hintMarkup = hint ? `<span class="econ-group-hint">${hint}</span>` : '';
    return `<details class="econ-group">
      <summary>
        <span class="econ-group-copy">
          <span class="econ-group-title">${title}</span>
          ${hintMarkup}
        </span>
        <span class="econ-group-summary">${summary}</span>
      </summary>
      <div class="econ-group-body">${rowsHtml}</div>
    </details>`;
  },

  econRow(label, value, cls = '', title = '') {
    const safeTitle = title
      ? ` title="${String(title).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`
      : '';
    return `<div class="econ-row ${cls}"${safeTitle}>
      <span class="econ-label">${label}</span>
      <span class="econ-value">${value}</span>
    </div>`;
  },

  updateImpact(r) {
    const cycleUnit = this.getCycleRateUnit(r);
    const env = r.environmental;
    const html = [
      this.prodItem('co2', '🌍', 'CO₂ Captured', `${FormatNumbers.fixed(env.co2Captured, 1)}`, 'tons/yr'),
      this.prodItem('ch4', '♻️', 'CO₂ Displaced', `${FormatNumbers.fixed(env.co2Displaced, 1)}`, 'tons/yr'),
      this.prodItem('solar', '📐', 'Land Use', `${FormatNumbers.fixed(env.landAcres, 1)}`, 'acres'),
      this.prodItem('h2', '♻️', 'Water Recycled', `${FormatNumbers.fixed(env.waterRecycledDaily, 0)}`, `L/${cycleUnit}`),
      this.prodItem('h2', '💧', 'Net Water Needed', `${FormatNumbers.fixed(env.netWaterDaily, 0)}`, `L/${cycleUnit}`),
    ];
    document.getElementById('impactGrid').innerHTML = html.join('');
  },

  formatConfigValue(unit, value) {
    const numeric = parseFloat(value);
    if (unit === '%') return `${FormatNumbers.fixed(numeric, numeric % 1 ? 1 : 0)}%`;
    if (unit === '$') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}`;
    if (unit === '$/W') return `$${FormatNumbers.fixed(numeric, 2)}/W`;
    if (unit === '$/kW') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}/kW`;
    if (unit === '$/t-yr') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}/t-yr`;
    if (unit === '$/kg-feed-hr') return `$${FormatNumbers.fixed(Math.round(numeric), 0)}/(kg/h feed)`;
    if (unit === 'kWh/kg') return `${FormatNumbers.fixed(Math.round(numeric), 0)} kWh/kg`;
    if (unit === 'kWh/t') return `${FormatNumbers.fixed(Math.round(numeric), 0)} kWh/t`;
    return `${FormatNumbers.fixed(numeric, Number.isInteger(numeric) ? 0 : 2)}`;
  },

  formatMoney(val) {
    return FormatNumbers.formatMoney(val);
  },

  formatIrr(val) {
    if (!Number.isFinite(val) || val <= -99.9) return 'N/A';
    return `${FormatNumbers.fixed(val, 1)}%`;
  },
};
