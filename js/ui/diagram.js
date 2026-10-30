/* ============================================
   System Diagram — SVG flow diagram of the modeled plant
   (cards laid out row by row, then power/feedstock connections)
   ============================================ */

import { FormatNumbers } from './format-numbers.js';
import { escapeHtml as esc } from './renderers/markup.js';

const branchOffset = (from, to, amount) => {
  if (!from || !to) return 0;
  if (to.cx < from.cx) return -amount;
  if (to.cx > from.cx) return amount;
  return 0;
};

// Upstream feeds of an exploratory route ({ h2, co2, methanol }, derived
// from its feedstocks by the module catalog); every route also draws power.
const exploratoryFeeds = module => module.routeConfig?.diagramInputs || {};

/**
 * Row-by-row card placement for the diagram. Each `place*` call reserves the next row
 * (or block of rows) below the previous one and appends positioned nodes to `nodes`.
 */
function createDiagramLayout(width, makeNode) {
  const nodes = [];
  const marginX = 22;
  const marginY = 22;
  const rowGap = 24;
  const stackGap = 10;
  const availableWidth = Math.max(320, width - marginX * 2);
  const narrow = availableWidth < 520;
  const singleWidth = Math.max(150, Math.min(200, availableWidth - 56));
  const pairGap = 20;
  const centerX = width / 2;
  const largeHeight = 68;
  const smallHeight = 56;
  let cursorTop = marginY;

  const reserveRow = blockHeight => {
    const top = cursorTop;
    cursorTop += blockHeight + rowGap;
    return top;
  };

  const addNode = (item, cx, top, w, h) => {
    nodes.push(makeNode(item.id, cx, top + h / 2, w, h, item.icon || '', item.title, item.value, item.subtitle, item.color, item.active !== false));
  };

  // Most columns that fit, avoiding a lone card on the last row.
  const chooseColumns = (count, maxColumns, minWidth) => {
    if (narrow) return 1;
    const fitColumns = Math.max(1, Math.floor((availableWidth + pairGap) / (minWidth + pairGap)));
    const upperBound = Math.min(count, maxColumns, fitColumns);
    for (let columns = upperBound; columns >= 1; columns -= 1) {
      const remainder = count % columns;
      if (remainder !== 1 || count <= columns) return columns;
    }
    return 1;
  };

  const placeGrid = (items, {
    cardHeight = smallHeight,
    singleCardWidth = singleWidth,
    wideMinWidth = 138,
    wideMaxWidth = 178,
    maxColumns = 3,
  } = {}) => {
    if (!items.length) return;

    const columns = chooseColumns(items.length, maxColumns, wideMinWidth);
    const cardWidth = columns === 1
      ? singleCardWidth
      : Math.max(wideMinWidth, Math.min(wideMaxWidth, (availableWidth - pairGap * (columns - 1)) / columns));
    const rows = Math.ceil(items.length / columns);
    const blockHeight = rows * cardHeight + (rows - 1) * stackGap;
    const top = reserveRow(blockHeight);

    for (let row = 0; row < rows; row += 1) {
      const rowItems = items.slice(row * columns, row * columns + columns);
      const rowWidth = rowItems.length * cardWidth + (rowItems.length - 1) * pairGap;
      const startX = centerX - rowWidth / 2 + cardWidth / 2;

      rowItems.forEach((item, index) => {
        addNode(item, startX + index * (cardWidth + pairGap), top + row * (cardHeight + stackGap), cardWidth, cardHeight);
      });
    }
  };

  // One row whose cards sit as close as possible to the requested x centres without overlapping.
  const placeAnchoredRow = (items, centers, {
    cardHeight = smallHeight,
    cardWidth = Math.max(138, Math.min(178, singleWidth)),
    fallbackMaxColumns = 3,
  } = {}) => {
    if (!items.length) return;

    const resolvedCenters = centers.filter(center => Number.isFinite(center));
    if (resolvedCenters.length < items.length) {
      placeGrid(items, {
        cardHeight,
        singleCardWidth: cardWidth,
        wideMinWidth: Math.min(cardWidth, 138),
        wideMaxWidth: cardWidth,
        maxColumns: fallbackMaxColumns,
      });
      return;
    }

    const minCenter = marginX + cardWidth / 2;
    const maxCenter = width - marginX - cardWidth / 2;
    const minCenterGap = cardWidth + pairGap;
    const anchored = items.map((item, index) => ({
      item,
      center: Math.max(minCenter, Math.min(maxCenter, resolvedCenters[index])),
    }));

    for (let index = 1; index < anchored.length; index += 1) {
      anchored[index].center = Math.max(anchored[index].center, anchored[index - 1].center + minCenterGap);
    }

    const overflow = anchored[anchored.length - 1].center - maxCenter;
    if (overflow > 0) {
      anchored.forEach(entry => {
        entry.center -= overflow;
      });
    }

    for (let index = anchored.length - 2; index >= 0; index -= 1) {
      anchored[index].center = Math.min(anchored[index].center, anchored[index + 1].center - minCenterGap);
    }

    if (anchored[0].center < minCenter) {
      const shift = minCenter - anchored[0].center;
      anchored.forEach(entry => {
        entry.center += shift;
      });
    }

    const top = reserveRow(cardHeight);
    anchored.forEach(({ item, center }) => addNode(item, center, top, cardWidth, cardHeight));
  };

  return {
    nodes,
    smallHeight,
    largeHeight,
    singleWidth,
    placeGrid,
    placeAnchoredRow,
    height: () => Math.max(360, cursorTop - rowGap + marginY),
  };
}

export const Diagram = {
  colors: {
    solar: '#c6923a',
    electric: '#5f7fb8',
    battery: '#6c76a9',
    ai: '#78a6d8',
    h2: '#6ba5b5',
    co2: '#8c84b4',
    methane: '#6ba177',
    methanol: '#b47b41',
    exploratory: '#8d99a8',
    inactive: '#46515d',
  },

  syncTheme() {
    if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return;
    const styles = getComputedStyle(document.documentElement);
    const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    this.colors = {
      solar: read('--solar', this.colors.solar),
      electric: read('--electric', this.colors.electric),
      battery: read('--battery', this.colors.battery),
      ai: read('--ai', this.colors.ai),
      h2: read('--h2', this.colors.h2),
      co2: read('--co2', this.colors.co2),
      methane: read('--methane', this.colors.methane),
      methanol: read('--fuel', this.colors.methanol),
      exploratory: read('--text-muted', this.colors.exploratory),
      inactive: read('--border-light', this.colors.inactive),
    };
  },

  render(container, results) {
    this.syncTheme();
    const width = container.clientWidth || 900;
    const { nodes, height } = this.buildNodes(results, width);
    const connections = this.buildConnections(nodes, results);

    container.style.height = `${height}px`;

    container.innerHTML = [
      // No style attribute: the CSP has no 'unsafe-inline' for styles. Width and font
      // come from .diagram-svg; the pixel height is set through CSSOM below.
      `<svg class="diagram-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`,
      '<defs><filter id="cardShadow"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.35"/></filter></defs>',
      this.drawGrid(width, height),
      ...connections.map(connection => this.drawConn(connection)),
      ...nodes.map(node => this.drawCard(node)),
      '</svg>',
    ].join('\n');
    const svg = container.querySelector?.('svg.diagram-svg');
    if (svg) svg.style.height = `${height}px`;
  },

  drawGrid(width, height) {
    let lines = '<g opacity="0.04">';
    for (let x = 0; x < width; x += 40) lines += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#fff"/>`;
    for (let y = 0; y < height; y += 40) lines += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#fff"/>`;
    return `${lines}</g>`;
  },

  buildNodes(r, width) {
    const layout = createDiagramLayout(width, (...args) => this.node(...args));
    const exploratoryCards = r.exploratoryModules.filter(module => module.enabled);
    const exploratoryCardsWhere = predicate => exploratoryCards
      .filter(module => predicate(exploratoryFeeds(module)))
      .map(module => this.makeExploratoryCard(module, r));
    const { smallHeight, largeHeight, singleWidth } = layout;
    const singleSolarRow = { cardHeight: largeHeight, singleCardWidth: singleWidth, wideMinWidth: 150, wideMaxWidth: 200, maxColumns: 1 };

    // Rows top to bottom: sun, array, battery, power consumers, downstream products, product-fed routes, outputs.
    layout.placeGrid([this.makeSunCard(r)], singleSolarRow);
    layout.placeGrid([this.makeArrayCard(r)], singleSolarRow);

    if (r.storage.enabled) {
      layout.placeGrid([this.makeBatteryCard(r)], {
        cardHeight: smallHeight,
        singleCardWidth: Math.min(singleWidth, 182),
        wideMinWidth: 150,
        wideMaxWidth: 182,
        maxColumns: 1,
      });
    }

    layout.placeGrid([
      ...this.makeCoreProcessCards(r),
      ...exploratoryCardsWhere(inputs => !inputs.h2 && !inputs.co2 && !inputs.methanol),
    ], {
      cardHeight: largeHeight,
      maxColumns: 4,
    });

    layout.placeGrid([
      ...this.makeSupportedProductCards(r),
      ...exploratoryCardsWhere(inputs => inputs.h2 || inputs.co2),
    ], {
      cardHeight: smallHeight,
      maxColumns: 3,
    });

    layout.placeGrid(exploratoryCardsWhere(inputs => inputs.methanol && !inputs.h2 && !inputs.co2), {
      cardHeight: smallHeight,
      maxColumns: 3,
    });

    this.placeOutputCards(layout, this.makeOutputCards(r));

    return {
      nodes: layout.nodes,
      height: layout.height(),
    };
  },

  makeSunCard(r) {
    return {
      id: 'sun',
      title: 'Solar resource',
      value: `${FormatNumbers.fixed(r.solar.baseYield, 0)} MWh/MWdc-yr`,
      subtitle: `${FormatNumbers.fixed(r.solar.ghi, 0)} kWh/m²/yr  ·  ${FormatNumbers.fixed(r.solar.sunHours, 1)} ${r.solar.hoursPerCycleLabel}`,
      color: this.colors.solar,
      active: true,
    };
  },

  makeArrayCard(r) {
    return {
      id: 'array',
      title: 'Solar array',
      value: this.formatSolarSystemSize(r.solar.peakPowerKW),
      subtitle: this.formatAnnualEnergy(r.solar.annualMWh),
      color: this.colors.solar,
      active: true,
    };
  },

  makeBatteryCard(r) {
    return {
      id: 'battery',
      title: 'Battery',
      value: `${r.storage.battCapKWh.toLocaleString()} kWh`,
      subtitle: `${this.formatPowerMagnitude(r.chemicalSupply.processPowerKW)} firmed chem cap`,
      color: this.colors.battery,
      active: true,
    };
  },

  /** AI, electrolyzer and DAC: the loads fed directly by the array. */
  makeCoreProcessCards(r) {
    const cards = [];
    if (r.ai.enabled) {
      cards.push({
        id: 'ai',
        title: 'AI datacenter',
        value: this.formatInstalledPowerKW(r.ai.designLoadKW),
        subtitle: `${FormatNumbers.fixed(r.ai.utilization * 100, 2)}% delivered · ${FormatNumbers.fixed(r.ai.fullPowerReliability * 100, 2)}% full-rate`,
        color: this.colors.ai,
        active: true,
      });
    }
    if (r.electrolyzer.enabled) {
      cards.push({
        id: 'electrolyzer',
        title: 'Electrolyzer',
        value: this.formatInstalledPowerKW(r.electrolyzer.allocKW),
        subtitle: this.formatAnnualMass(r.electrolyzer.h2AnnualKg, 'H2'),
        color: this.colors.h2,
        active: true,
      });
    }
    if (r.dac.enabled) {
      cards.push({
        id: 'dac',
        title: 'DAC',
        value: this.formatInstalledPowerKW(r.dac.allocKW),
        subtitle: this.formatAnnualMass(r.dac.co2AnnualKg, 'CO2'),
        color: this.colors.co2,
        active: true,
      });
    }
    return cards;
  },

  makeSupportedProductCards(r) {
    return r.supportedModules
      .filter(module => module.enabled && module.modeled)
      .map(module => ({
        id: module.id,
        icon: '',
        title: module.title || module.label,
        value: this.formatMassRate(module.designHourlyOutputKg),
        subtitle: module.id === 'methanol'
          ? this.formatAnnualMass(module.annualKg)
          : this.formatAnnualMass(module.ch4AnnualKg, 'CH4'),
        color: module.id === 'methanol' ? this.colors.methanol : this.colors.methane,
        active: module.active !== false,
      }));
  },

  makeExploratoryCard(module, r) {
    return {
      id: `exp-${module.id}`,
      icon: '',
      title: module.label,
      value: module.outputDailyUnits > 0
        ? this.formatExploratoryPeakOutput(module, r)
        : (module.routeLabel || module.routeOptions.find(option => option.value === module.route)?.label || module.route),
      subtitle: module.feedstockSummary || 'Needs power',
      color: this.colors.exploratory,
      active: true,
    };
  },

  makeOutputCards(r) {
    const outputs = [];
    if (r.ai.enabled) {
      outputs.push({
        id: 'out-ai',
        icon: '',
        title: 'AI output',
        value: `${FormatNumbers.fixed(r.ai.annualTokensM / 1000, 2)} B tok/yr`,
        subtitle: `${FormatNumbers.formatMoney(r.economics.revenue.ai)} /yr`,
        color: this.colors.ai,
      });
    }
    if (r.sabatier.enabled) {
      outputs.push({
        id: 'out-methane',
        icon: '',
        title: 'Methane output',
        value: `${FormatNumbers.fixed(r.sabatier.ch4AnnualMCF, 0)} MCF/yr`,
        subtitle: `${FormatNumbers.formatMoney(r.economics.revenue.methane)} /yr`,
        color: this.colors.methane,
      });
    }
    const methanolAnnualTons = r.methanol.exportAnnualTons;
    if (r.methanol.enabled && methanolAnnualTons > 0.1) {
      outputs.push({
        id: 'out-methanol',
        icon: '',
        title: 'Methanol output',
        value: `${FormatNumbers.fixed(methanolAnnualTons, 1)} t/yr`,
        subtitle: `${FormatNumbers.formatMoney(r.economics.revenue.methanol)} /yr`,
        color: this.colors.methanol,
      });
    }
    (r.economics.exploratoryDetails || []).forEach(module => {
      outputs.push({
        id: `out-exp-${module.id}`,
        icon: '',
        title: module.outputLabel || module.label,
        value: this.formatExploratoryAnnualOutput(module),
        subtitle: `${FormatNumbers.formatMoney(module.annualRevenue)} /yr`,
        color: this.colors.exploratory,
      });
    });
    return outputs;
  },

  /**
   * With AI on and at most two product outputs, keep each output under its source
   * (AI under the datacenter, products under electrolyzer/DAC); otherwise use a plain grid.
   */
  placeOutputCards(layout, outputs) {
    const aiOutput = outputs.find(output => output.id === 'out-ai');
    const productOutputs = outputs.filter(output => output.id !== 'out-ai');
    const outputGrid = { cardHeight: layout.smallHeight, maxColumns: 3 };

    if (!aiOutput || productOutputs.length > 2) {
      layout.placeGrid(outputs, outputGrid);
      return;
    }

    const centerOf = id => layout.nodes.find(node => node.id === id)?.cx;
    const outputCards = [aiOutput, ...productOutputs];
    const outputCenters = [centerOf('ai')];
    if (productOutputs.length === 1) {
      outputCenters.push(centerOf('dac') ?? centerOf('electrolyzer'));
    } else if (productOutputs.length === 2) {
      outputCenters.push(centerOf('electrolyzer'), centerOf('dac'));
    }

    layout.placeAnchoredRow(outputCards, outputCenters, {
      cardHeight: layout.smallHeight,
      cardWidth: Math.min(layout.singleWidth, 178),
      fallbackMaxColumns: 3,
    });
  },

  buildConnections(nodes, r) {
    const get = id => nodes.find(node => node.id === id);
    const cycleHours = Number.isFinite(r?.solar?.cycleHours) && r.solar.cycleHours > 0
      ? r.solar.cycleHours
      : 24;
    const context = { r, get, cycleHours };

    return [
      ...this.buildPowerConnections(context),
      ...this.buildSupportedProductConnections(context),
      ...this.buildAiOutputConnections(context),
      ...this.buildExploratoryConnections(context),
    ];
  },

  /** Sun -> array -> battery / AI / electrolyzer / DAC. */
  buildPowerConnections({ r, get, cycleHours }) {
    const connections = [];
    const sun = get('sun');
    const array = get('array');
    const battery = get('battery');
    const ai = get('ai');
    const electrolyzer = get('electrolyzer');
    const dac = get('dac');

    if (sun && array) {
      connections.push(this.conn(sun, array, this.colors.solar, '', true, {
        width: 3,
        route: 'vertical',
      }));
    }
    if (array && battery) {
      connections.push(this.conn(array, battery, this.colors.battery, '', true, {
        width: 1.5,
        route: 'vertical',
      }));
    }
    if (array && ai) {
      connections.push(this.conn(
        array,
        ai,
        this.colors.ai,
        this.formatAveragePowerKW(
          r.ai.designLoadKW * (Number.isFinite(r.ai.utilization) ? r.ai.utilization : 1)
        ),
        true,
        {
          width: 2.2,
          route: 'vertical',
          fromOffsetX: branchOffset(array, ai, 46),
          labelOffsetX: branchOffset(array, ai, 38),
          labelOffsetY: ai.cx === array.cx ? -10 : -2,
        }
      ));
    }
    if (battery && ai) {
      connections.push(this.conn(battery, ai, this.colors.battery, '', true, {
        width: 1.2,
        route: 'vertical',
        fromOffsetX: branchOffset(battery, ai, 18),
      }));
    }
    if (array && electrolyzer) {
      connections.push(this.conn(
        array,
        electrolyzer,
        this.colors.electric,
        this.formatAveragePowerFromCycleKWh(r.electrolyzer.dailyKWh, cycleHours),
        r.electrolyzer.enabled,
        {
          width: 2,
          route: 'vertical',
          fromOffsetX: branchOffset(array, electrolyzer, 46),
          labelOffsetX: branchOffset(array, electrolyzer, 38),
          labelOffsetY: electrolyzer.cx === array.cx ? -10 : -2,
        }
      ));
    }
    if (array && dac) {
      connections.push(this.conn(
        array,
        dac,
        this.colors.electric,
        this.formatAveragePowerFromCycleKWh(r.dac.dailyKWh, cycleHours),
        r.dac.enabled,
        {
          width: 2,
          route: 'vertical',
          fromOffsetX: branchOffset(array, dac, 46),
          labelOffsetX: branchOffset(array, dac, 38),
          labelOffsetY: dac.cx === array.cx ? 10 : -2,
        }
      ));
    }
    return connections;
  },

  /** H2 + CO2 feeds into methane/methanol reactors, and each reactor to its output card. */
  buildSupportedProductConnections({ get, r, cycleHours }) {
    const connections = [];
    const electrolyzer = get('electrolyzer');
    const dac = get('dac');

    r.supportedModules.filter(module => module.enabled && module.modeled).forEach(module => {
      const node = get(module.id);
      if (!node) return;
      if (module.id === 'sabatier' || module.id === 'methanol') {
        connections.push(this.conn(electrolyzer, node, this.colors.h2, this.formatAverageMassFlow(module.h2Consumed, cycleHours, 'H2'), true, {
          width: 2,
          route: 'vertical',
          fromOffsetX: branchOffset(electrolyzer, node, 28),
          toOffsetX: -18,
          labelOffsetX: -24,
          labelOffsetY: -8,
        }));
        connections.push(this.conn(dac, node, this.colors.co2, this.formatAverageMassFlow(module.co2Consumed, cycleHours, 'CO2'), true, {
          width: 2,
          route: 'vertical',
          fromOffsetX: branchOffset(dac, node, 28),
          toOffsetX: 18,
          labelOffsetX: 24,
          labelOffsetY: 8,
        }));
      }
      const outNode = get(`out-${module.id === 'sabatier' ? 'methane' : module.id}`);
      if (outNode) {
        connections.push(this.conn(node, outNode, module.id === 'methanol' ? this.colors.methanol : this.colors.methane, '', true, {
          width: 2.5,
          route: 'vertical',
          fromOffsetX: branchOffset(node, outNode, 24),
        }));
      }
    });
    return connections;
  },

  buildAiOutputConnections({ get }) {
    const ai = get('ai');
    const aiOutput = get('out-ai');
    if (!ai || !aiOutput) return [];
    return [this.conn(ai, aiOutput, this.colors.ai, '', true, {
      width: 2.5,
      route: 'vertical',
    })];
  },

  /** Power and feedstock lines into each exploratory route, and route to output. */
  buildExploratoryConnections({ get, r, cycleHours }) {
    const connections = [];
    const array = get('array');
    const electrolyzer = get('electrolyzer');
    const dac = get('dac');

    r.exploratoryModules.filter(module => module.enabled).forEach(module => {
      const node = get(`exp-${module.id}`);
      if (!node) return;

      const diagramInputs = exploratoryFeeds(module);
      if (array) {
        const dailyPowerLabel = module.dailyKWh > 0
          ? this.formatAveragePowerFromCycleKWh(module.dailyKWh, cycleHours)
          : '';
        connections.push(this.conn(array, node, this.colors.electric, dailyPowerLabel, true, {
          width: 1.2,
          route: 'vertical',
          fromOffsetX: branchOffset(array, node, 50),
          toOffsetX: branchOffset(array, node, 18),
        }));
      }

      if (diagramInputs.h2 && electrolyzer) {
        const label = module.h2Consumed > 0 ? this.formatAverageMassFlow(module.h2Consumed, cycleHours, 'H2') : '';
        connections.push(this.conn(electrolyzer, node, this.colors.h2, label, r.electrolyzer.enabled, {
          width: 1.4,
          route: 'vertical',
          fromOffsetX: branchOffset(electrolyzer, node, 28),
          toOffsetX: diagramInputs.co2 ? -18 : 0,
        }));
      }

      if (diagramInputs.co2 && dac) {
        const label = module.co2Consumed > 0 ? this.formatAverageMassFlow(module.co2Consumed, cycleHours, 'CO2') : '';
        connections.push(this.conn(dac, node, this.colors.co2, label, r.dac.enabled, {
          width: 1.4,
          route: 'vertical',
          fromOffsetX: branchOffset(dac, node, 28),
          toOffsetX: diagramInputs.h2 ? 18 : 0,
        }));
      }

      if (diagramInputs.methanol) {
        const methanolSource = get('methanol') || get('out-methanol');
        const label = module.methanolConsumed > 0 ? this.formatAverageMassFlow(module.methanolConsumed, cycleHours, 'MeOH') : '';
        connections.push(this.conn(methanolSource, node, this.colors.methanol, label, Boolean(r.methanol?.enabled), {
          width: 1.4,
          route: 'vertical',
          fromOffsetX: branchOffset(methanolSource, node, 28),
        }));
      }

      const outNode = get(`out-exp-${module.id}`);
      if (outNode) {
        connections.push(this.conn(node, outNode, this.colors.exploratory, '', true, {
          width: 2,
          route: 'vertical',
          fromOffsetX: branchOffset(node, outNode, 24),
        }));
      }
    });
    return connections;
  },

  formatSolarSystemSize(peakPowerKW) {
    if (!Number.isFinite(peakPowerKW) || peakPowerKW <= 0) return '0 kWdc';
    if (peakPowerKW >= 1000) {
      const mwdc = peakPowerKW / 1000;
      const decimals = mwdc >= 100 ? 0 : mwdc >= 10 ? 1 : 2;
      return `${FormatNumbers.fixed(mwdc, decimals)} MWdc`;
    }
    return `${FormatNumbers.fixed(peakPowerKW, peakPowerKW >= 10 ? 0 : 1)} kWdc`;
  },

  rateDecimals(value) {
    const magnitude = Math.abs(Number(value) || 0);
    if (magnitude >= 100) return 0;
    if (magnitude >= 1) return 1;
    return 2;
  },

  formatPowerMagnitude(kw) {
    if (!Number.isFinite(kw) || kw <= 0) return '0 kW';
    if (kw >= 1_000_000) {
      const gw = kw / 1_000_000;
      return `${FormatNumbers.fixed(gw, this.rateDecimals(gw))} GW`;
    }
    if (kw >= 1000) {
      const mw = kw / 1000;
      return `${FormatNumbers.fixed(mw, this.rateDecimals(mw))} MW`;
    }
    return `${FormatNumbers.fixed(kw, this.rateDecimals(kw))} kW`;
  },

  formatInstalledPowerKW(kw) {
    return `Peak ${this.formatPowerMagnitude(kw)}`;
  },

  formatAveragePowerKW(kw) {
    return `Avg ${this.formatPowerMagnitude(kw)}`;
  },

  formatAveragePowerFromCycleKWh(cycleKWh, cycleHours) {
    const averageKW = Number.isFinite(cycleKWh) && Number.isFinite(cycleHours) && cycleHours > 0
      ? cycleKWh / cycleHours
      : 0;
    return this.formatAveragePowerKW(averageKW);
  },

  formatMassRate(kgPerHour) {
    return this.formatLabeledMassRate(kgPerHour, '', 'Peak');
  },

  formatLabeledMassRate(kgPerHour, material = '', prefix = 'Peak') {
    const materialSuffix = material ? ` ${material}` : '';
    if (!Number.isFinite(kgPerHour) || kgPerHour <= 0) return `${prefix} 0 kg${materialSuffix}/h`;
    if (kgPerHour >= 1000) {
      const tonsPerHour = kgPerHour / 1000;
      return `${prefix} ${FormatNumbers.fixed(tonsPerHour, this.rateDecimals(tonsPerHour))} t${materialSuffix}/h`;
    }
    return `${prefix} ${FormatNumbers.fixed(kgPerHour, this.rateDecimals(kgPerHour))} kg${materialSuffix}/h`;
  },

  formatAverageMassFlow(cycleKg, cycleHours, material = '') {
    const kgPerHour = Number.isFinite(cycleKg) && Number.isFinite(cycleHours) && cycleHours > 0
      ? cycleKg / cycleHours
      : 0;
    return this.formatLabeledMassRate(kgPerHour, material, 'Avg');
  },

  formatLabeledUnitRate(unitsPerHour, unit, prefix = 'Peak') {
    if (!Number.isFinite(unitsPerHour) || unitsPerHour <= 0) return `${prefix} 0 ${unit}/h`;
    return `${prefix} ${FormatNumbers.fixed(unitsPerHour, this.rateDecimals(unitsPerHour))} ${unit}/h`;
  },

  formatAnnualEnergy(mwh) {
    if (!Number.isFinite(mwh) || mwh <= 0) return '0 MWh/yr';
    return `${FormatNumbers.fixed(mwh, mwh >= 100 ? 0 : 1)} MWh/yr`;
  },

  formatAnnualMass(annualKg, suffix = '') {
    if (!Number.isFinite(annualKg) || annualKg <= 0) {
      return suffix ? `0 kg ${suffix}/yr` : '0 kg/yr';
    }

    if (annualKg >= 1000) {
      const annualTons = annualKg / 1000;
      const decimals = annualTons >= 100 ? 0 : 1;
      return suffix
        ? `${FormatNumbers.fixed(annualTons, decimals)} t ${suffix}/yr`
        : `${FormatNumbers.fixed(annualTons, decimals)} t/yr`;
    }

    return suffix
      ? `${FormatNumbers.fixed(annualKg, annualKg >= 10 ? 0 : 1)} kg ${suffix}/yr`
      : `${FormatNumbers.fixed(annualKg, annualKg >= 10 ? 0 : 1)} kg/yr`;
  },

  formatExploratoryPeakOutput(module, results) {
    if (!module || !(module.outputDailyUnits > 0)) {
      return module?.routeLabel || module?.route || 'Exploratory';
    }
    const peakUnitsPerHour = module.capexSizingOutputUnitsPerHour > 0
      ? module.capexSizingOutputUnitsPerHour
      : module.peakOutputUnitsPerHour;
    return this.formatLabeledUnitRate(peakUnitsPerHour, module.outputUnit === 'm3' ? 'm3' : 't', 'Peak');
  },

  formatExploratoryAnnualOutput(module) {
    if (!module || !(module.annualOutputUnits > 0)) return '0 /yr';
    if (module.outputUnit === 'm3') {
      return `${FormatNumbers.fixed(module.annualOutputUnits, module.annualOutputUnits >= 100 ? 0 : 1)} m3/yr`;
    }
    return `${FormatNumbers.fixed(module.annualOutputUnits, module.annualOutputUnits >= 100 ? 0 : 1)} t/yr`;
  },

  node(id, cx, cy, w, h, icon, title, value, subtitle, color, active) {
    return { id, x: cx - w / 2, y: cy - h / 2, cx, cy, w, h, icon, title, value, subtitle, color, active };
  },

  conn(from, to, color, label, active, options = {}) {
    if (!from || !to) return null;
    const {
      width = 2,
      labelOffsetX = 0,
      labelOffsetY = 0,
      route = 'auto',
      fromOffsetX = 0,
      fromOffsetY = 0,
      toOffsetX = 0,
      toOffsetY = 0,
    } = options;
    return { from, to, color, label, active, width, labelOffsetX, labelOffsetY, route, fromOffsetX, fromOffsetY, toOffsetX, toOffsetY };
  },

  buildConnPath(connection) {
    const {
      from,
      to,
      route,
      fromOffsetX,
      fromOffsetY,
      toOffsetX,
      toOffsetY,
    } = connection;
    const verticalFlow = route === 'vertical' || (route !== 'horizontal' && to.cy >= from.cy);

    if (verticalFlow) {
      const x1 = from.cx + fromOffsetX;
      const y1 = from.y + from.h + fromOffsetY;
      const x2 = to.cx + toOffsetX;
      const y2 = to.y + toOffsetY;
      const dy = Math.max(36, y2 - y1);
      const control = Math.max(22, Math.min(54, dy * 0.35));
      return {
        x1,
        y1,
        x2,
        y2,
        path: `M${x1},${y1} C${x1},${y1 + control} ${x2},${y2 - control} ${x2},${y2}`,
      };
    }

    const x1 = from.x + from.w + fromOffsetX;
    const y1 = from.cy + fromOffsetY;
    const x2 = to.x + toOffsetX;
    const y2 = to.cy + toOffsetY;
    const dx = x2 - x1;
    const cpx = dx * 0.45;
    return {
      x1,
      y1,
      x2,
      y2,
      path: `M${x1},${y1} C${x1 + cpx},${y1} ${x2 - cpx},${y2} ${x2},${y2}`,
    };
  },

  drawCard(node) {
    const { x, y, w, h, icon, title, value, subtitle, color, active } = node;
    const opacity = active ? 1 : 0.25;
    const fill = active ? this.rgba(color, 0.10) : '#151d30';
    const stroke = active ? this.rgba(color, 0.45) : '#2a3550';
    const tx = icon ? x + 30 : x + 12;
    const iconEl = icon
      ? `<text x="${x + 12}" y="${y + h / 2 + 1}" font-size="18" dominant-baseline="middle">${esc(icon)}</text>`
      : '';
    return `<g opacity="${opacity}" filter="url(#cardShadow)">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
      ${iconEl}
      <text x="${tx}" y="${y + 16}" font-size="11" font-weight="700" fill="#e2e8f0">${esc(title)}</text>
      <text x="${tx}" y="${y + 30}" font-size="12" font-weight="600" fill="${esc(color)}">${esc(value)}</text>
      ${subtitle ? `<text x="${tx}" y="${y + h - 8}" font-size="9" fill="#64748b">${esc(this.trunc(subtitle, 30))}</text>` : ''}
    </g>`;
  },

  drawConn(connection) {
    if (!connection) return '';
    const { color, label, active, width, labelOffsetX, labelOffsetY } = connection;
    if (!active) return this.drawInactiveLine(connection);
    const { x1, y1, x2, y2, path } = this.buildConnPath(connection);

    let svg = `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-dasharray="6 3" opacity="0.7">
      <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1.2s" repeatCount="indefinite"/>
    </path>`;

    if (label) {
      const mx = (x1 + x2) / 2 + labelOffsetX;
      const my = (y1 + y2) / 2 + labelOffsetY;
      const textWidth = label.length * 5.5 + 10;
      svg += `<rect x="${mx - textWidth / 2}" y="${my - 8}" width="${textWidth}" height="14" rx="4" fill="#111827" fill-opacity="0.9" stroke="${color}" stroke-width="0.5" stroke-opacity="0.3"/>`;
      svg += `<text x="${mx}" y="${my + 2}" text-anchor="middle" font-size="8.5" font-weight="600" fill="${esc(color)}" opacity="0.9">${esc(label)}</text>`;
    }

    return svg;
  },

  drawInactiveLine(connection) {
    const { path } = this.buildConnPath(connection);
    return `<path d="${path}" fill="none" stroke="#2a3550" stroke-width="1" stroke-dasharray="4 4" opacity="0.3"/>`;
  },

  rgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  },

  trunc(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  },
};
