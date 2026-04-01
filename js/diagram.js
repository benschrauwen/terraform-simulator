/* ============================================
   System Diagram — Registry driven renderer
   ============================================ */

const Diagram = {
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
      `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:${height}px;font-family:inherit;">`,
      '<defs><filter id="cardShadow"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.35"/></filter></defs>',
      this.drawGrid(width, height),
      ...connections.map(connection => this.drawConn(connection)),
      ...nodes.map(node => this.drawCard(node)),
      '</svg>',
    ].join('\n');
  },

  drawGrid(width, height) {
    let lines = '<g opacity="0.04">';
    for (let x = 0; x < width; x += 40) lines += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#fff"/>`;
    for (let y = 0; y < height; y += 40) lines += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#fff"/>`;
    return `${lines}</g>`;
  },

  buildNodes(r, width) {
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

    const addNode = (id, cx, top, w, h, icon, title, value, subtitle, color, active) => {
      nodes.push(this.node(id, cx, top + h / 2, w, h, icon, title, value, subtitle, color, active));
    };

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
          addNode(
            item.id,
            startX + index * (cardWidth + pairGap),
            top + row * (cardHeight + stackGap),
            cardWidth,
            cardHeight,
            item.icon || '',
            item.title,
            item.value,
            item.subtitle,
            item.color,
            item.active !== false
          );
        });
      }
    };

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
      anchored.forEach(({ item, center }) => {
        addNode(
          item.id,
          center,
          top,
          cardWidth,
          cardHeight,
          item.icon || '',
          item.title,
          item.value,
          item.subtitle,
          item.color,
          item.active !== false
        );
      });
    };

    const exploratoryCards = r.exploratoryModules
      .filter(module => module.enabled)
      .map(module => ({
        ...module,
        diagramInputs: this.getExploratoryDiagramInputs(module),
      }));

    const makeExploratoryCard = module => ({
      id: `exp-${module.id}`,
      icon: '',
      title: module.label,
      value: module.outputDailyUnits > 0
        ? this.formatExploratoryPeakOutput(module, r)
        : (module.routeLabel || module.routeOptions.find(option => option.value === module.route)?.label || module.route),
      subtitle: module.feedstockSummary || 'Needs power',
      color: this.colors.exploratory,
      active: true,
    });

    placeGrid([{
      id: 'sun',
      title: 'Solar resource',
      value: `${FormatNumbers.fixed(r.solar.baseYield, 0)} MWh/MWdc-yr`,
      subtitle: `${FormatNumbers.fixed(r.solar.ghi, 0)} kWh/m²/yr  ·  ${FormatNumbers.fixed(r.solar.sunHours, 1)} ${r.solar.hoursPerCycleLabel}`,
      color: this.colors.solar,
      active: true,
    }], {
      cardHeight: largeHeight,
      singleCardWidth: singleWidth,
      wideMinWidth: 150,
      wideMaxWidth: 200,
      maxColumns: 1,
    });

    placeGrid([{
      id: 'array',
      title: 'Solar array',
      value: this.formatSolarSystemSize(r.solar.peakPowerKW),
      subtitle: this.formatAnnualEnergy(r.solar.annualMWh),
      color: this.colors.solar,
      active: true,
    }], {
      cardHeight: largeHeight,
      singleCardWidth: singleWidth,
      wideMinWidth: 150,
      wideMaxWidth: 200,
      maxColumns: 1,
    });

    if (r.storage.enabled) {
      placeGrid([{
        id: 'battery',
        title: 'Battery',
        value: `${r.storage.battCapKWh.toLocaleString()} kWh`,
        subtitle: `${FormatNumbers.fixed(r.chemicalSupply.processPowerKW, 0)} kW firmed chemical cap`,
        color: this.colors.battery,
        active: true,
      }], {
        cardHeight: smallHeight,
        singleCardWidth: Math.min(singleWidth, 182),
        wideMinWidth: 150,
        wideMaxWidth: 182,
        maxColumns: 1,
      });
    }

    const coreProcessCards = [
      ...(r.ai.enabled
        ? [{
            id: 'ai',
            title: 'AI datacenter',
            value: (() => {
              const aiLoadMW = r.ai.designLoadKW / 1000;
              return aiLoadMW >= 1000
                ? `${FormatNumbers.fixed(aiLoadMW / 1000, 2)} GW`
                : `${FormatNumbers.fixed(aiLoadMW, 1)} MW`;
            })(),
            subtitle: `${FormatNumbers.fixed(r.ai.utilization * 100, 2)}% delivered · ${FormatNumbers.fixed(r.ai.fullPowerReliability * 100, 2)}% full-rate`,
            color: this.colors.ai,
            active: true,
          }]
        : []),
      ...(r.electrolyzer.enabled
        ? [{
            id: 'electrolyzer',
            title: 'Electrolyzer',
            value: this.formatInstalledPowerKW(r.electrolyzer.allocKW),
            subtitle: this.formatAnnualMass(r.electrolyzer.h2AnnualKg, 'H2'),
            color: this.colors.h2,
            active: true,
          }]
        : []),
      ...(r.dac.enabled
        ? [{
            id: 'dac',
            title: 'DAC',
            value: this.formatInstalledPowerKW(r.dac.allocKW),
            subtitle: this.formatAnnualMass(r.dac.co2AnnualKg, 'CO2'),
            color: this.colors.co2,
            active: true,
          }]
        : []),
      ...exploratoryCards
        .filter(module => !module.diagramInputs.h2 && !module.diagramInputs.co2 && !module.diagramInputs.methanol)
        .map(makeExploratoryCard),
    ];

    placeGrid(coreProcessCards, {
      cardHeight: largeHeight,
      maxColumns: 4,
    });

    const supported = r.supportedModules.filter(module => module.enabled && module.modeled);
    const supportedCards = supported.map(module => {
      const color = module.id === 'methanol' ? this.colors.methanol : this.colors.methane;
      const value = this.formatMassRate(module.designHourlyOutputKg);
      const subtitle = module.id === 'methanol'
        ? this.formatAnnualMass(module.annualKg)
        : this.formatAnnualMass(module.ch4AnnualKg, 'CH4');
      return {
        id: module.id,
        icon: '',
        title: module.title || module.label,
        value,
        subtitle,
        color,
        active: module.active !== false,
      };
    });
    const primaryFeedstockExploratoryCards = exploratoryCards
      .filter(module => module.diagramInputs.h2 || module.diagramInputs.co2)
      .map(makeExploratoryCard);
    const productFeedstockExploratoryCards = exploratoryCards
      .filter(module => module.diagramInputs.methanol && !module.diagramInputs.h2 && !module.diagramInputs.co2)
      .map(makeExploratoryCard);
    const downstreamCards = [...supportedCards, ...primaryFeedstockExploratoryCards];

    placeGrid(downstreamCards, {
      cardHeight: smallHeight,
      maxColumns: 3,
    });

    placeGrid(productFeedstockExploratoryCards, {
      cardHeight: smallHeight,
      maxColumns: 3,
    });

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
    if (r.methanol.enabled) {
      outputs.push({
        id: 'out-methanol',
        icon: '',
        title: 'Methanol output',
        value: `${FormatNumbers.fixed(r.methanol.annualTons, 1)} t/yr`,
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
    const aiOutput = outputs.find(output => output.id === 'out-ai');
    const productOutputs = outputs.filter(output => output.id !== 'out-ai');
    const getNodeById = id => nodes.find(node => node.id === id);

    if (aiOutput) {
      const outputCards = [aiOutput];
      const outputCenters = [getNodeById('ai')?.cx];

      if (productOutputs.length === 1) {
        outputCards.push(productOutputs[0]);
        outputCenters.push(getNodeById('dac')?.cx ?? getNodeById('electrolyzer')?.cx);
      } else if (productOutputs.length === 2) {
        outputCards.push(productOutputs[0], productOutputs[1]);
        outputCenters.push(getNodeById('electrolyzer')?.cx, getNodeById('dac')?.cx);
      } else if (productOutputs.length > 2) {
        placeGrid(outputs, {
          cardHeight: smallHeight,
          maxColumns: 3,
        });
        return {
          nodes,
          height: Math.max(360, cursorTop - rowGap + marginY),
        };
      }

      placeAnchoredRow(outputCards, outputCenters, {
        cardHeight: smallHeight,
        cardWidth: Math.min(singleWidth, 178),
        fallbackMaxColumns: 3,
      });
    } else {
      placeGrid(outputs, {
        cardHeight: smallHeight,
        maxColumns: 3,
      });
    }

    return {
      nodes,
      height: Math.max(360, cursorTop - rowGap + marginY),
    };
  },

  buildConnections(nodes, r) {
    const get = id => nodes.find(node => node.id === id);
    const connections = [];
    const sun = get('sun');
    const array = get('array');
    const battery = get('battery');
    const ai = get('ai');
    const electrolyzer = get('electrolyzer');
    const dac = get('dac');
    const branchOffset = (from, to, amount = 42) => {
      if (!from || !to) return 0;
      if (to.cx < from.cx) return -amount;
      if (to.cx > from.cx) return amount;
      return 0;
    };
    const branchLabelOffset = (from, to, amount = 34) => {
      if (!from || !to) return 0;
      if (to.cx < from.cx) return -amount;
      if (to.cx > from.cx) return amount;
      return 0;
    };

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
      connections.push(this.conn(array, ai, this.colors.ai, `${FormatNumbers.fixed(r.ai.designLoadKW / 1000, 1)} MW`, true, {
        width: 2.2,
        route: 'vertical',
        fromOffsetX: branchOffset(array, ai, 46),
        labelOffsetX: branchLabelOffset(array, ai, 38),
        labelOffsetY: ai.cx === array.cx ? -10 : -2,
      }));
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
        `${FormatNumbers.fixed(r.electrolyzer.dailyKWh / 1000, 1)} MWh/d`,
        r.electrolyzer.enabled,
        {
          width: 2,
          route: 'vertical',
          fromOffsetX: branchOffset(array, electrolyzer, 46),
          labelOffsetX: branchLabelOffset(array, electrolyzer, 38),
          labelOffsetY: electrolyzer.cx === array.cx ? -10 : -2,
        }
      ));
    }
    if (array && dac) {
      connections.push(this.conn(
        array,
        dac,
        this.colors.electric,
        `${FormatNumbers.fixed(r.dac.dailyKWh / 1000, 1)} MWh/d`,
        r.dac.enabled,
        {
          width: 2,
          route: 'vertical',
          fromOffsetX: branchOffset(array, dac, 46),
          labelOffsetX: branchLabelOffset(array, dac, 38),
          labelOffsetY: dac.cx === array.cx ? 10 : -2,
        }
      ));
    }

    r.supportedModules.filter(module => module.enabled && module.modeled).forEach(module => {
      const node = get(module.id);
      if (!node) return;
      if (module.id === 'sabatier') {
        connections.push(this.conn(electrolyzer, node, this.colors.h2, `${FormatNumbers.fixed(module.h2Consumed, 0)} kg H2`, true, {
          width: 2,
          route: 'vertical',
          fromOffsetX: branchOffset(electrolyzer, node, 28),
          toOffsetX: -18,
          labelOffsetX: -24,
          labelOffsetY: -8,
        }));
        connections.push(this.conn(dac, node, this.colors.co2, `${FormatNumbers.fixed(module.co2Consumed, 0)} kg CO2`, true, {
          width: 2,
          route: 'vertical',
          fromOffsetX: branchOffset(dac, node, 28),
          toOffsetX: 18,
          labelOffsetX: 24,
          labelOffsetY: 8,
        }));
      } else if (module.id === 'methanol') {
        connections.push(this.conn(electrolyzer, node, this.colors.h2, `${FormatNumbers.fixed(module.h2Consumed, 0)} kg H2`, true, {
          width: 2,
          route: 'vertical',
          fromOffsetX: branchOffset(electrolyzer, node, 28),
          toOffsetX: -18,
          labelOffsetX: -24,
          labelOffsetY: -8,
        }));
        connections.push(this.conn(dac, node, this.colors.co2, `${FormatNumbers.fixed(module.co2Consumed, 0)} kg CO2`, true, {
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

    const aiOutput = get('out-ai');
    if (ai && aiOutput) {
      connections.push(this.conn(ai, aiOutput, this.colors.ai, '', true, {
        width: 2.5,
        route: 'vertical',
      }));
    }

    r.exploratoryModules.filter(module => module.enabled).forEach(module => {
      const node = get(`exp-${module.id}`);
      if (!node) return;

      const diagramInputs = this.getExploratoryDiagramInputs(module);
      if (diagramInputs.electricity && array) {
        const dailyPowerLabel = module.dailyKWh > 0 ? `${FormatNumbers.fixed(module.dailyKWh / 1000, 1)} MWh/d` : '';
        connections.push(this.conn(array, node, this.colors.electric, dailyPowerLabel, true, {
          width: 1.2,
          route: 'vertical',
          fromOffsetX: branchOffset(array, node, 50),
          toOffsetX: branchOffset(array, node, 18),
        }));
      }

      if (diagramInputs.h2 && electrolyzer) {
        const label = module.h2Consumed > 0 ? `${FormatNumbers.fixed(module.h2Consumed, 0)} kg H2` : '';
        connections.push(this.conn(electrolyzer, node, this.colors.h2, label, r.electrolyzer.enabled, {
          width: 1.4,
          route: 'vertical',
          fromOffsetX: branchOffset(electrolyzer, node, 28),
          toOffsetX: diagramInputs.co2 ? -18 : 0,
        }));
      }

      if (diagramInputs.co2 && dac) {
        const label = module.co2Consumed > 0 ? `${FormatNumbers.fixed(module.co2Consumed, 0)} kg CO2` : '';
        connections.push(this.conn(dac, node, this.colors.co2, label, r.dac.enabled, {
          width: 1.4,
          route: 'vertical',
          fromOffsetX: branchOffset(dac, node, 28),
          toOffsetX: diagramInputs.h2 ? 18 : 0,
        }));
      }

      if (diagramInputs.methanol) {
        const methanolSource = get('methanol') || get('out-methanol');
        const label = module.methanolConsumed > 0 ? `${FormatNumbers.fixed(module.methanolConsumed / 1000, 1)} t MeOH` : '';
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

  // Feedstock inputs affect placement; electricity adds a power connection only.
  getExploratoryDiagramInputs(module) {
    return {
      electricity: true,
      h2: false,
      co2: false,
      methanol: false,
      ...(module?.diagramInputs || {}),
    };
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

  formatInstalledPowerKW(kw) {
    if (!Number.isFinite(kw) || kw <= 0) return 'Peak 0 kW';
    return `Peak ${FormatNumbers.fixed(kw, kw >= 10 ? 0 : 1)} kW`;
  },

  formatMassRate(kgPerHour) {
    if (!Number.isFinite(kgPerHour) || kgPerHour <= 0) return 'Peak 0 kg/h';
    return `Peak ${FormatNumbers.fixed(kgPerHour, kgPerHour >= 10 ? 0 : 1)} kg/h`;
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

    const cycleUnit = results?.solar?.cycleUnitCompact || 'day';
    const peakOutputDailyUnits = module.peakOutputDailyUnits > 0
      ? module.peakOutputDailyUnits
      : module.outputDailyUnits;
    if (module.outputUnit === 'm3') {
      return `Peak ${FormatNumbers.fixed(peakOutputDailyUnits, peakOutputDailyUnits >= 10 ? 0 : 1)} m3/${cycleUnit}`;
    }
    return `Peak ${FormatNumbers.fixed(peakOutputDailyUnits, peakOutputDailyUnits >= 10 ? 0 : 1)} t/${cycleUnit}`;
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
      ? `<text x="${x + 12}" y="${y + h / 2 + 1}" font-size="18" dominant-baseline="middle">${icon}</text>`
      : '';
    return `<g opacity="${opacity}" filter="url(#cardShadow)">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
      ${iconEl}
      <text x="${tx}" y="${y + 16}" font-size="11" font-weight="700" fill="#e2e8f0">${title}</text>
      <text x="${tx}" y="${y + 30}" font-size="12" font-weight="600" fill="${color}">${value}</text>
      ${subtitle ? `<text x="${tx}" y="${y + h - 8}" font-size="9" fill="#64748b">${this.trunc(subtitle, 30)}</text>` : ''}
    </g>`;
  },

  drawConn(connection) {
    if (!connection) return '';
    const { from, to, color, label, active, width, labelOffsetX, labelOffsetY } = connection;
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
      svg += `<text x="${mx}" y="${my + 2}" text-anchor="middle" font-size="8.5" font-weight="600" fill="${color}" opacity="0.9">${label}</text>`;
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

  formatMoney(val) {
    return FormatNumbers.formatMoney(val);
  },
};
