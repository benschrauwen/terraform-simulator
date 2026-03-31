/* Rendering helpers attached to App */

window.AppRendererMethods = {
  updateInfoDisplays(r) {
    document.getElementById('ghiValue').textContent = `${FormatNumbers.fixed(r.solar.ghi, 0)} kWh/m²/yr`;
    document.getElementById('sunHoursValue').textContent = `${FormatNumbers.fixed(r.solar.sunHours, 1)} ${r.solar.hoursPerCycleLabel}`;
    document.getElementById('yieldSourceValue').textContent = r.solar.yieldSource;
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
    const displayedCf = r.ai.enabled
      ? r.chemicalSupply.effectiveCF
      : (r.storage.enabled ? r.chemicalSupply.effectiveCF : r.solar.capacityFactor);
    const displayedHours = r.ai.enabled
      ? r.ai.chemicalDailyOpHours
      : (r.storage.enabled ? r.chemicalSupply.dailyOpHours : r.solar.sunHours);
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

    const geo = r.solar.solarGeo;
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

    const cf = r.storage.enabled ? r.chemicalSupply.effectiveCF : r.solar.capacityFactor;
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
    Diagram.render(document.getElementById('diagramContainer'), r);
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
    if (r.methanol.enabled) {
      rows.push(this.prodItem('fuel', '🧪', 'Methanol', `${FormatNumbers.fixed(r.methanol.dailyLiters, 1)}`, `L/${cycleUnit}`));
    }
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
    let html = '';
    html += this.econRow('Installed CAPEX', '', 'header');
    html += this.econRow('Solar modules', this.formatMoney(solarBreakdown.solarModules || 0));
    html += this.econRow('Solar structure + install BOS', this.formatMoney(solarBreakdown.solarBos || 0));
    if ((solarBreakdown.solarLand || 0) > 0) html += this.econRow('Land acquisition', this.formatMoney(solarBreakdown.solarLand));
    if ((solarBreakdown.solarSitePrep || 0) > 0) html += this.econRow('Site prep', this.formatMoney(solarBreakdown.solarSitePrep));
    html += this.econRow('Total solar installation', this.formatMoney(e.capex.solar));
    if (e.capex.battery > 0) html += this.econRow('Battery', this.formatMoney(e.capex.battery));
    if (e.capex.ai > 0) html += this.econRow('AI datacenter', this.formatMoney(e.capex.ai));
    if (e.capex.electrolyzer > 0) html += this.econRow('Electrolyzer', this.formatMoney(e.capex.electrolyzer));
    if (e.capex.dac > 0) html += this.econRow('DAC', this.formatMoney(e.capex.dac));
    if (e.capex.sabatier > 0) html += this.econRow('Methane reactor', this.formatMoney(e.capex.sabatier));
    if (e.capex.methanol > 0) html += this.econRow('Methanol reactor', this.formatMoney(e.capex.methanol));
    html += this.econRow('Total CAPEX', this.formatMoney(e.totalCapex), 'total');

    if (e.financing.enabled) {
      html += this.econRow('Financing', '', 'header');
      html += this.econRow('Debt share', `${FormatNumbers.fixed(e.financing.debtSharePercent, 0)}% of upfront CAPEX`);
      html += this.econRow('Debt-funded at close', this.formatMoney(e.financing.debtAmount), 'positive');
      html += this.econRow('Equity-funded CAPEX', this.formatMoney(e.financing.equityCapex), 'negative');
      if (e.financing.upfrontFee > 0) {
        html += this.econRow('Upfront financing fee', this.formatMoney(e.financing.upfrontFee), 'negative');
      }
      html += this.econRow('Total sponsor cash at close', this.formatMoney(e.financing.equityUpfront), 'negative');
      html += this.econRow('Debt coupon', `${FormatNumbers.fixed(e.financing.debtInterestRate, 2)}%`);
      html += this.econRow('Debt term', `${FormatNumbers.fixed(e.financing.debtTermYears, 0)} years`);
      if (e.financing.totalDebtService > 0) {
        html += this.econRow(
          'Annual debt service',
          this.formatMoney(e.financing.annualDebtService),
          'negative',
          'Modeled as a level-payment amortizing loan over the selected debt term.'
        );
        html += this.econRow('Total debt interest', this.formatMoney(e.financing.totalInterest), 'negative');
      }
    }

    html += this.econRow('Levelized annual cost (CRF)', '', 'header');
    html += this.econRow(
      'Capital recovery',
      this.formatMoney(e.annualizedCapexTotal),
      'negative',
      `Upfront CAPEX x capital recovery factor at ${FormatNumbers.fixed(this.state.discountRate, 1)}% and each asset's book life. This is the economic annual capital charge, not straight-line depreciation.`
    );
    if (r.ai.enabled && r.ai.annualOM > 0) {
      html += this.econRow('AI fixed O&M', this.formatMoney(r.ai.annualOM), 'negative');
    }
    html += this.econRow('Total O&M', this.formatMoney(e.annualOM), 'negative');
    html += this.econRow('Total levelized annual cost', this.formatMoney(e.annualCost), 'negative');

    html += this.econRow('Revenue', '', 'header');
    if (e.revenue.ai > 0) {
      html += this.econRow('AI token price', `$${FormatNumbers.fixed(this.state.aiTokenPricePerM, 2)} / 1M tokens`);
      html += this.econRow('AI throughput', `${Math.round(this.state.aiMillionTokensPerMWh).toLocaleString()} M tokens/MWh`);
      html += this.econRow('AI tokens sold', `${FormatNumbers.fixed(r.ai.annualTokensM / 1000, 2)}B /yr`);
      html += this.econRow('AI token revenue', this.formatMoney(e.revenue.ai), 'positive');
    }
    if (e.revenue.methane > 0) {
      html += this.econRow('Methane market scope', methaneMarket.applicability);
      html += this.econRow('Methane market basis', methaneMarket.label);
    }
    if (e.revenue.methane > 0) html += this.econRow(`Methane @ $${FormatNumbers.fixed(e.methaneSalePrice, 2)}/MCF`, this.formatMoney(e.revenue.methane), 'positive');
    if (e.revenue.methanol > 0) html += this.econRow('Methanol sales', this.formatMoney(e.revenue.methanol), 'positive');
    if (e.policy.mode !== 'none') {
      html += this.econRow('Policy scope', e.policy.applicability);
      html += this.econRow('Policy basis', e.policy.basis);
      if (Number.isFinite(e.policy.durationYears)) {
        html += this.econRow('Policy duration', `${FormatNumbers.fixed(e.policy.durationYears, 0)} years`);
      }
      if (e.policy.co2Credit > 0) {
        const co2Basis = e.policy.mode === 'us_45q_sequestration'
          ? 'Eligible sequestered CO₂'
          : e.policy.mode === 'us_45q_utilization'
            ? 'Eligible utilized CO₂'
            : 'Eligible CO₂';
        html += this.econRow(co2Basis, `${FormatNumbers.fixed(e.policy.eligibleCo2Tons, 1)} tons/yr`);
      }
    }
    if (e.revenue.policyCredits > 0) html += this.econRow(e.policy.label, this.formatMoney(e.revenue.policyCredits), 'positive');
    html += this.econRow('Total Revenue', this.formatMoney(e.totalAnnualRevenue), 'total');

    if (r.h2Surplus > 0.1 || r.co2Surplus > 0.1) {
      html += this.econRow('Losses / Unused Output', '', 'header');
      if (r.h2Surplus > 0.1) {
        html += this.econRow('Unused H₂', `${FormatNumbers.fixed(r.h2Surplus, 1)} kg/${this.getCycleRateUnit(r)}`);
      }
      if (r.co2Surplus > 0.1) {
        html += this.econRow('Unused CO₂', `${FormatNumbers.fixed(r.co2Surplus, 1)} kg/${this.getCycleRateUnit(r)}`);
      }
    }

    html += this.econRow('Key Metrics', '', 'header');
    const projectNpvLabel = e.financing.enabled ? 'Project NPV' : 'NPV';
    const projectIrrLabel = e.financing.enabled ? 'Project IRR' : 'IRR';
    const projectPaybackLabel = e.financing.enabled ? 'Project Payback' : 'Payback';
    html += this.econRow(
      'Annual profit (levelized)',
      this.formatMoney(e.annualProfit),
      e.annualProfit >= 0 ? 'positive' : 'negative',
      'Revenue minus total levelized annual cost (capital recovery + O&M).'
    );
    html += this.econRow(
      projectNpvLabel,
      this.formatMoney(e.npv),
      e.npv >= 0 ? 'positive' : 'negative',
      'Discounted cash flows: -upfront CAPEX in year 0, then yearly revenue minus O&M and any scheduled replacement CAPEX. CRF capital recovery is not repeated as a cash outflow.'
    );
    html += this.econRow(
      projectIrrLabel,
      this.formatIrr(e.projectIrr),
      Number.isFinite(e.projectIrr) ? (e.projectIrr >= 0 ? 'positive' : 'negative') : '',
      'Internal rate of return on the same net-cash path as NPV after O&M and scheduled replacements.'
    );
    if (e.financing.enabled) {
      html += this.econRow(
        'Equity IRR',
        this.formatIrr(e.equityIrr),
        Number.isFinite(e.equityIrr) ? (e.equityIrr >= 0 ? 'positive' : 'negative') : '',
        'IRR on sponsor equity cash flows: upfront equity plus financing fees in year 0, then project net cash after scheduled debt service.'
      );
    }
    html += this.econRow(
      projectPaybackLabel,
      Number.isFinite(e.paybackYears) ? `${FormatNumbers.fixed(e.paybackYears, 1)} years` : 'N/A',
      '',
      'Simple payback on cumulative net cash versus upfront CAPEX. This is the first point where cumulative net cash turns positive.'
    );
    const sustainedProjectPaybackLabel = e.financing.enabled ? 'Sustained project payback' : 'Sustained payback';
    const showSustainedProjectPayback = Number.isFinite(e.sustainedPaybackYears)
      ? Math.abs(e.sustainedPaybackYears - e.paybackYears) > 1e-6
      : Number.isFinite(e.paybackYears);
    if (showSustainedProjectPayback) {
      html += this.econRow(
        sustainedProjectPaybackLabel,
        Number.isFinite(e.sustainedPaybackYears) ? `${FormatNumbers.fixed(e.sustainedPaybackYears, 1)} years` : 'N/A',
        '',
        'Payback only if the project stays cumulative-cash positive through the full selected horizon after scheduled replacements.'
      );
    }
    if (e.financing.enabled) {
      html += this.econRow(
        'Equity payback',
        Number.isFinite(e.equityPaybackYears) ? `${FormatNumbers.fixed(e.equityPaybackYears, 1)} years` : 'N/A',
        '',
        'Simple payback on cumulative sponsor equity cash after scheduled debt service.'
      );
      const showSustainedEquityPayback = Number.isFinite(e.sustainedEquityPaybackYears)
        ? Math.abs(e.sustainedEquityPaybackYears - e.equityPaybackYears) > 1e-6
        : Number.isFinite(e.equityPaybackYears);
      if (showSustainedEquityPayback) {
        html += this.econRow(
          'Sustained equity payback',
          Number.isFinite(e.sustainedEquityPaybackYears) ? `${FormatNumbers.fixed(e.sustainedEquityPaybackYears, 1)} years` : 'N/A',
          '',
          'Equity payback only if sponsor cash stays cumulative-positive through the full selected horizon after debt service and replacements.'
        );
      }
    }
    if (e.totalReplacementOutflows > 0) {
      html += this.econRow(
        'Scheduled replacements',
        this.formatMoney(e.totalReplacementOutflows),
        'negative',
        'Full equipment replacement CAPEX that lands inside the selected analysis horizon and is included in NPV, IRR, ROI, and payback.'
      );
    }

    if (r.ai.enabled) {
      html += this.econRow('AI load auto-sized', this.formatSystemSizeMW(r.ai.designLoadKW / 1000));
      html += this.econRow('Served-energy utilization', `${FormatNumbers.fixed(r.ai.utilization * 100, 2)}%`);
      html += this.econRow('Full-rate reliability', `${FormatNumbers.fixed(r.ai.fullPowerReliability * 100, 2)}%`);
      html += this.econRow('Integrated AI cost', `$${FormatNumbers.fixed(e.costPerMToken, 2)} / 1M tokens`);
      html += this.econRow('Token margin', `${e.tokenMarginPerM >= 0 ? '+' : ''}$${FormatNumbers.fixed(e.tokenMarginPerM, 2)} / 1M`, e.tokenMarginPerM >= 0 ? 'positive' : 'negative');
    }
    if (e.costPerKgH2 > 0) html += this.econRow('Integrated H₂ cost', `$${FormatNumbers.fixed(e.costPerKgH2, 2)}/kg`);
    if (e.costPerTonCO2 > 0) html += this.econRow('Integrated CO₂ cost', `$${FormatNumbers.fixed(e.costPerTonCO2, 0)}/ton`);
    if (e.costPerMCF > 0) html += this.econRow('Integrated CH₄ cost', `$${FormatNumbers.fixed(e.costPerMCF, 2)}/MCF`);

    if (e.excludedModules.length) {
      html += this.econRow('Excluded from ROI', '', 'header');
      html += this.econRow('Exploratory modules', e.excludedModules.join(', '));
    }

    document.getElementById('econBreakdown').innerHTML = html;
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
