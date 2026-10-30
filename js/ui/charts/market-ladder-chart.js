/* Market ladder: Terraform's product-market tiers as a descending price step
   (log-log, x = cumulative annual market volume), with this site's working
   point (annual output, levelized cost) and the assumed sale price. */

import { LADDER_TIER_KINDS } from '../../data/market-ladders.js';
import { buildMarketLadder, getMarketPosition, getSiteWorkingPoint } from '../../model/market-ladder.js';
import { FormatNumbers } from '../format-numbers.js';
import { escapeHtml } from '../renderers/markup.js';
import { axisGrid, axisTicks, axisTitle, clearChartUnavailable, ensureChartRuntime, legendLabels } from './chart-utils.js';

const PRODUCTS = [
  { key: 'methane', color: '#10b981', isActive: r => Boolean(r?.sabatier?.enabled) && (r.sabatier.ch4AnnualMCF || 0) > 0 },
  { key: 'methanol', color: '#f97316', isActive: r => Boolean(r?.methanol?.enabled) && (r.methanol.exportAnnualTons || 0) > 0 },
];

// Segment colors follow Terraform's methanol chart: as made, purified, methanol-to-X.
const KIND_COLORS = { 'as-is': '#5f7fb8', purified: '#22c55e', mtx: '#a855f7' };
const SALE_PRICE_COLOR = '#f59e0b';
const SITE_LABEL = 'This site (levelized cost)';
const SALE_PRICE_LABEL = 'Your sale price (Market & Incentives)';
// Tiers the site cannot serve at its cost stay readable but recede.
const DIMMED_ALPHA = '99';

function compact(value) {
  const abs = Math.abs(value);
  const scaled = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']].find(([size]) => abs >= size);
  if (!scaled) return FormatNumbers.fixed(value, value < 10 ? 1 : 0);
  const [size, suffix] = scaled;
  return `${FormatNumbers.fixed(value / size, value / size < 10 ? 1 : 0)}${suffix}`;
}

const price = (value, ladder) => (ladder.priceUnit === '$/t'
  ? `$${FormatNumbers.fixed(value, 0)}/t`
  : `$${FormatNumbers.fixed(value, value < 10 ? 2 : 1)}/MMBtu`);

function getAxisBounds(ladder, point) {
  const decade = value => Math.pow(10, Math.floor(Math.log10(value)));
  const lowestPrice = Math.min(ladder.tiers.at(-1).price, point.unitCost, point.salePrice || Infinity);
  const highestPrice = Math.max(ladder.tiers[0].price, point.unitCost);
  return {
    xMin: decade(Math.min(point.annualVolume, ladder.tiers[0].volume) / 3),
    xMax: ladder.totalVolume * 4,
    yMin: decade(lowestPrice / 1.5),
    yMax: highestPrice * 3,
  };
}

/** One step dataset per tier: its price shelf, then the drop to the next tier. */
function buildTierDatasets(ladder, position, xMin) {
  return ladder.tiers.map((tier, index) => {
    const next = ladder.tiers[index + 1];
    const cleared = position.clearedTiers.includes(tier);
    const color = KIND_COLORS[tier.kind] + (cleared ? '' : DIMMED_ALPHA);
    const data = [
      { x: index === 0 ? xMin : tier.startVolume, y: tier.price },
      { x: tier.endVolume, y: tier.price, corner: true },
      ...(next ? [{ x: tier.endVolume, y: next.price }] : []),
    ];
    return {
      label: tier.label,
      tier,
      data,
      showLine: true,
      borderColor: color,
      backgroundColor: color,
      borderWidth: cleared ? 2.5 : 1.5,
      pointRadius: data.map(pointData => (pointData.corner ? 3 : 0)),
      pointHoverRadius: data.map(pointData => (pointData.corner ? 5 : 0)),
    };
  });
}

/** Tier names drawn at the left end of each shelf, skipping any that would overlap. */
const tierLabelPlugin = {
  id: 'marketLadderTierLabels',
  afterDatasetsDraw(chart, args, { ladder, salePrice }) {
    const { ctx, chartArea } = chart;
    const placed = [];
    ctx.save();
    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'bottom';
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (!dataset.tier) return;
      const meta = chart.getDatasetMeta(datasetIndex);
      const start = meta.data[0];
      if (!start) return;
      const text = `${dataset.tier.label} · ${price(dataset.tier.price, ladder)}`;
      const width = ctx.measureText(text).width;
      const x = Math.min(Math.max(start.x + 4, chartArea.left + 2), chartArea.right - width - 2);
      const y = start.y - 3;
      const box = { left: x, right: x + width, top: y - 10, bottom: y };
      if (y - 10 < chartArea.top || placed.some(other => box.left < other.right && box.right > other.left
        && box.top < other.bottom && box.bottom > other.top)) return;
      placed.push(box);
      ctx.fillStyle = dataset.borderColor;
      ctx.fillText(text, x, y);
    });

    const saleIndex = chart.data.datasets.findIndex(dataset => dataset.label === SALE_PRICE_LABEL);
    const saleLine = chart.getDatasetMeta(saleIndex)?.data?.[0];
    if (saleLine && saleLine.y > chartArea.top + 12 && saleLine.y < chartArea.bottom) {
      const text = `Your sale price · ${price(salePrice, ladder)}`;
      ctx.fillStyle = SALE_PRICE_COLOR;
      ctx.textAlign = 'right';
      ctx.fillText(text, chartArea.right - 4, saleLine.y - 3);
    }
    ctx.restore();
  },
};

function createLadderChart(canvas, ladder, point, position, color) {
  const bounds = getAxisBounds(ladder, point);
  const datasets = [
    ...buildTierDatasets(ladder, position, bounds.xMin),
    {
      label: SALE_PRICE_LABEL,
      data: [{ x: bounds.xMin, y: point.salePrice }, { x: bounds.xMax, y: point.salePrice }],
      showLine: true,
      borderColor: SALE_PRICE_COLOR,
      borderDash: [5, 4],
      borderWidth: 1.5,
      pointStyle: 'line',
      pointRadius: 0,
      pointHoverRadius: 0,
    },
    {
      label: SITE_LABEL,
      data: [{ x: point.annualVolume, y: point.unitCost }],
      borderColor: '#f8fafc',
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 7,
      pointHoverRadius: 9,
      pointStyle: 'circle',
    },
  ];

  return new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    plugins: [tierLabelPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        // Only the site dot and the sale-price line need a key; tiers are labelled in place.
        legend: {
          display: true,
          position: 'bottom',
          labels: legendLabels({
            usePointStyle: true,
            boxHeight: 6,
            filter: item => item.text === SITE_LABEL || item.text === SALE_PRICE_LABEL,
          }),
        },
        marketLadderTierLabels: { ladder, salePrice: point.salePrice },
        tooltip: {
          filter: item => item.dataset.label !== SALE_PRICE_LABEL || item.dataIndex === 0,
          callbacks: {
            label(context) {
              const { dataset } = context;
              if (dataset.tier) {
                const { tier } = dataset;
                return [
                  `${tier.label}: ${price(tier.price, ladder)}`,
                  `${LADDER_TIER_KINDS[tier.kind]}; market to here ${FormatNumbers.formatMoney(tier.cumulativeMarket)}/yr`,
                ];
              }
              if (dataset.label === SITE_LABEL) {
                return [
                  `This site: ${price(point.unitCost, ladder)} levelized cost`,
                  `${FormatNumbers.fixed(point.annualNativeVolume, 0)} ${point.nativeUnit} sold`,
                ];
              }
              return `${SALE_PRICE_LABEL}: ${price(point.salePrice, ladder)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'logarithmic',
          min: bounds.xMin,
          max: bounds.xMax,
          title: axisTitle(`Cumulative annual market volume (${ladder.volumeUnit})`),
          ticks: axisTicks({ callback: value => (Number.isInteger(Math.log10(value)) ? compact(value) : '') }),
          grid: axisGrid(),
        },
        y: {
          type: 'logarithmic',
          min: bounds.yMin,
          max: bounds.yMax,
          title: axisTitle(`Price or levelized cost (${ladder.priceUnit})`),
          ticks: axisTicks({ callback: value => (/^[125]$/.test(String(value / Math.pow(10, Math.floor(Math.log10(value))))) ? `$${compact(value)}` : '') }),
          grid: axisGrid(),
        },
      },
    },
  });
}

function describePosition(ladder, point, position) {
  const parts = [
    `This site sells ${escapeHtml(FormatNumbers.fixed(point.annualNativeVolume, 0))} ${escapeHtml(point.nativeUnit)} at a levelized cost of `
      + `<strong>${escapeHtml(price(point.unitCost, ladder))}</strong> (allocated plant cost, output credits excluded).`,
  ];
  const cleared = position.clearedTiers;
  if (cleared.length) {
    parts.push(`That clears ${cleared.length} of ${ladder.tiers.length} tiers, down to ${escapeHtml(cleared.at(-1).label)}, `
      + `a ${escapeHtml(FormatNumbers.formatMoney(position.addressableMarket))}/yr market in total.`);
  } else {
    parts.push('That is above even the beachhead price, so no tier is profitable yet.');
  }
  if (position.nextTier) {
    parts.push(`The next tier, ${escapeHtml(position.nextTier.label)} at ${escapeHtml(price(position.nextTier.price, ladder))}, `
      + `needs the cost to fall ${escapeHtml(FormatNumbers.fixed(position.costCutToNextTier * 100, 0))}%.`);
  }
  if (Number.isFinite(point.salePrice)) {
    const margin = point.salePrice >= point.unitCost ? 'above' : 'below';
    parts.push(`The dashed line is the sale price you set under Market &amp; Incentives (${escapeHtml(price(point.salePrice, ladder))}), ${margin} this site's cost.`);
  }
  parts.push(`One site like this would fill ${escapeHtml(FormatNumbers.fixed(position.beachheadShare * 100, position.beachheadShare < 0.01 ? 2 : 1))}% of the beachhead tier.`);
  return parts.join(' ');
}

export const marketLadderChartMethods = {
  /** Products this build sells, in display order; the tab state lives on the App, not in shared state. */
  getMarketLadderProducts(r) {
    return PRODUCTS.filter(product => product.isActive(r));
  },

  updateMarketLadderChart(r) {
    const card = document.getElementById('marketLadderCard');
    const note = document.getElementById('marketLadderNote');
    const tabs = document.getElementById('marketLadderTabs');
    const products = this.getMarketLadderProducts(r);

    if (this.charts.marketLadder) {
      this.charts.marketLadder.destroy();
      delete this.charts.marketLadder;
    }
    if (card) card.hidden = products.length === 0;
    if (!products.length) {
      clearChartUnavailable('marketLadderChart');
      return;
    }

    if (!products.some(product => product.key === this.marketLadderProduct)) {
      this.marketLadderProduct = products[0].key;
    }
    if (tabs) {
      tabs.hidden = products.length < 2;
      tabs.querySelectorAll('[data-ladder-product]').forEach(button => {
        const available = products.some(product => product.key === button.dataset.ladderProduct);
        const active = button.dataset.ladderProduct === this.marketLadderProduct;
        button.hidden = !available;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
    }

    const product = products.find(candidate => candidate.key === this.marketLadderProduct);
    const ladder = buildMarketLadder(product.key);
    const point = getSiteWorkingPoint(product.key, r, this.state);
    const position = getMarketPosition(ladder, point);
    if (note) note.innerHTML = position ? describePosition(ladder, point, position) : '';
    if (!position || !ensureChartRuntime(this, 'marketLadder', 'marketLadderChart')) return;

    this.charts.marketLadder = createLadderChart(
      document.getElementById('marketLadderChart'), ladder, point, position, product.color
    );
  },

  bindMarketLadderTabs() {
    document.querySelectorAll('#marketLadderTabs [data-ladder-product]').forEach(button => {
      button.addEventListener('click', () => {
        this.marketLadderProduct = button.dataset.ladderProduct;
        if (this.lastResults) this.updateMarketLadderChart(this.lastResults);
      });
    });
  },
};

