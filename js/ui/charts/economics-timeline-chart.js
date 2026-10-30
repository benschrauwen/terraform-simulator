/* Economics-over-time chart: stacked annual cash items plus cumulative project / equity cash */

import { FormatNumbers } from '../format-numbers.js';
import {
  axisGrid,
  axisTicks,
  axisTitle,
  ensureChartRuntime,
  getAlignedZeroBounds,
  legendLabels,
} from './chart-utils.js';

const money = FormatNumbers.formatMoney;

function describeTimeline(timeline, financing) {
  const noteParts = [
    timeline.financed
      ? (timeline.hasPolicyCredits
          ? 'Bars show annual market revenue, incentive support, fixed O&M, scheduled replacements, and debt service when financing is enabled.'
          : 'Bars show annual revenue, fixed O&M, scheduled replacements, and debt service when financing is enabled.')
      : (timeline.hasPolicyCredits
          ? 'Bars show annual market revenue, incentive support, fixed O&M, and any scheduled replacement CAPEX.'
          : 'Bars show annual revenue, fixed O&M, and any scheduled replacement CAPEX.'),
    timeline.financed
      ? 'The dashed green line starts at upfront CAPEX and tracks cumulative project cash before financing; the solid blue line starts at sponsor cash at close and tracks cumulative equity cash after debt service.'
      : 'The green line starts at upfront CAPEX at close and tracks cumulative project cash through the selected analysis horizon.',
  ];
  if ((timeline.upfrontPolicySupport || 0) > 1e-9) {
    noteParts.push('If the selected scheme includes upfront capex support, the close bucket shows that support while the cumulative cash line starts from the net CAPEX at close.');
  }
  if (timeline.financed && timeline.hasSponsorSupport) {
    const uncoveredYears = financing?.uncoveredDebtServiceYearCount || 0;
    noteParts.push(
      `Debt service exceeds operating cash flow in ${uncoveredYears === 1 ? '1 year' : `${FormatNumbers.fixed(uncoveredYears, 0)} years`}; hover financed years to inspect sponsor support and remaining debt balance.`
    );
  } else if (timeline.financed && timeline.hasDebtService) {
    noteParts.push('Hover financed years to compare project cash, sponsor equity cash, and remaining debt balance.');
  }
  return noteParts.join(' ');
}

function cashBar(label, data, backgroundColor, borderColor) {
  return {
    type: 'bar',
    label,
    data,
    yAxisID: 'yAnnual',
    stack: 'cash-items',
    backgroundColor,
    borderColor,
    borderWidth: 1,
    borderRadius: 3,
    maxBarThickness: 18,
  };
}

function cumulativeLine(label, data, borderColor, backgroundColor, extra = {}) {
  return {
    type: 'line',
    label,
    data,
    yAxisID: 'yCumulative',
    borderColor,
    backgroundColor,
    borderWidth: 2,
    ...extra,
    tension: 0.2,
    fill: false,
    pointRadius: 0,
    pointHoverRadius: 3,
  };
}

const negate = values => values.map(value => -value);

function buildTimelineDatasets(timeline) {
  return [
    cashBar(
      timeline.hasPolicyCredits ? 'Market revenue' : 'Revenue',
      timeline.hasPolicyCredits ? timeline.annualMarketRevenue : timeline.annualRevenue,
      'rgba(16, 185, 129, 0.55)',
      '#10b981'
    ),
    ...(timeline.hasPolicyCredits
      ? [cashBar('Incentive support', timeline.annualPolicyCredits, 'rgba(250, 204, 21, 0.58)', '#facc15')]
      : []),
    cashBar('O&M', negate(timeline.annualOperatingCost), 'rgba(148, 163, 184, 0.55)', '#94a3b8'),
    ...(timeline.hasReplacements
      ? [cashBar('Replacement CAPEX', negate(timeline.replacementCapex), 'rgba(199, 115, 121, 0.62)', '#c77379')]
      : []),
    ...(timeline.hasDebtService
      ? [cashBar('Debt service', negate(timeline.annualDebtService), 'rgba(95, 127, 184, 0.6)', '#5f7fb8')]
      : []),
    cumulativeLine(
      'Cumulative project cash',
      timeline.cumulativeProjectCash,
      '#34d399',
      'rgba(52, 211, 153, 0.08)',
      { borderDash: timeline.financed ? [6, 4] : [] }
    ),
    ...(timeline.financed
      ? [cumulativeLine('Cumulative equity cash', timeline.cumulativeEquityCash, '#60a5fa', 'rgba(96, 165, 250, 0.08)')]
      : []),
  ];
}

/** Tooltip footer: close-date funding at index 0, then per-year project/equity detail. */
function timelineTooltipFooter(timeline, items) {
  if (!items.length) return '';
  const index = items[0].dataIndex;
  const lines = [];

  if (index === 0) {
    lines.push(`Gross upfront CAPEX: ${money(timeline.totalCapex)}`);
    if ((timeline.upfrontPolicySupport || 0) > 1e-9) {
      lines.push(`Upfront incentive support: ${money(timeline.upfrontPolicySupport)}`);
      lines.push(`Net project cash at close: ${money(timeline.projectCashFlow[index])}`);
    }
    if (timeline.financed) {
      lines.push(`Sponsor cash at close: ${money(timeline.equityCashFlow[index])}`);
      if (timeline.debtAmount > 0) {
        lines.push(`Debt funded at close: ${money(timeline.debtAmount)}`);
      }
    }
    return lines;
  }

  lines.push(`Project cash: ${money(timeline.projectCashFlow[index])}`);
  if (timeline.financed) {
    lines.push(`Equity cash: ${money(timeline.equityCashFlow[index])}`);
    const sponsorSupport = timeline.sponsorSupportNeeded[index] || 0;
    if (sponsorSupport > 1e-9) {
      lines.push(`Sponsor support needed: ${money(sponsorSupport)}`);
    }
    const debtEndingBalance = timeline.debtEndingBalance[index] || 0;
    if (debtEndingBalance > 1e-9) {
      lines.push(`Debt balance end-year: ${money(debtEndingBalance)}`);
    }
  }
  return lines;
}

export const economicsTimelineChartMethods = {
  updateEconomicsTimelineChart(r) {
    const timeline = r.economics?.cashFlowTimeline;
    const canvas = document.getElementById('economicsTimelineChart');
    if (!timeline || !canvas) return;

    const modeMeta = document.getElementById('economicsTimelineMode');
    if (modeMeta) {
      modeMeta.textContent = timeline.financed ? '— Project + sponsor cash' : '— Unlevered project cash';
    }

    const note = document.getElementById('economicsTimelineNote');
    if (note) note.textContent = describeTimeline(timeline, r.economics.financing);

    const datasets = buildTimelineDatasets(timeline);
    const chartKey = JSON.stringify({
      labels: timeline.labels,
      annualRevenue: timeline.annualRevenue,
      annualMarketRevenue: timeline.annualMarketRevenue,
      annualPolicyCredits: timeline.annualPolicyCredits,
      annualOperatingCost: timeline.annualOperatingCost,
      replacementCapex: timeline.replacementCapex,
      annualDebtService: timeline.annualDebtService,
      cumulativeProjectCash: timeline.cumulativeProjectCash,
      cumulativeEquityCash: timeline.financed ? timeline.cumulativeEquityCash : [],
    });
    if (!ensureChartRuntime(this, 'econTimeline', 'economicsTimelineChart')) return;
    if (this.chartKeys.econTimeline === chartKey && this.charts.econTimeline) return;

    const annualDatasets = datasets.filter(dataset => dataset.yAxisID === 'yAnnual');
    const cumulativeDatasets = datasets.filter(dataset => dataset.yAxisID === 'yCumulative');
    const alignedZeroBounds = getAlignedZeroBounds(annualDatasets, cumulativeDatasets, timeline.labels.length);
    const moneyTicks = () => axisTicks({ callback: value => money(Number(value)) });

    if (this.charts.econTimeline) this.charts.econTimeline.destroy();
    this.charts.econTimeline = new Chart(canvas, {
      data: {
        labels: timeline.labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { labels: legendLabels() },
          tooltip: {
            filter(ctx) {
              return Math.abs(ctx.parsed.y || 0) > 1e-9;
            },
            callbacks: {
              label(ctx) {
                return `${ctx.dataset.label}: ${money(ctx.parsed.y)}`;
              },
              footer: items => timelineTooltipFooter(timeline, items),
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: axisTicks({ maxTicksLimit: 10 }),
            grid: axisGrid(),
            title: axisTitle('Analysis year'),
          },
          yAnnual: {
            position: 'left',
            stacked: true,
            min: alignedZeroBounds.primary.min,
            max: alignedZeroBounds.primary.max,
            ticks: moneyTicks(),
            grid: axisGrid(),
            title: axisTitle('Annual cash items ($/yr)'),
          },
          yCumulative: {
            position: 'right',
            min: alignedZeroBounds.secondary.min,
            max: alignedZeroBounds.secondary.max,
            ticks: moneyTicks(),
            grid: { drawOnChartArea: false },
            title: axisTitle('Cumulative cash ($)'),
          },
        },
      },
    });

    this.chartKeys.econTimeline = chartKey;
  },
};
