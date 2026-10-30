/* Sensitivity panel: the shared NPV tornado chart driven by the datacenter tornado model, and the
   break-even revenue price. Both rerun the model, so the app refreshes them debounced. */

import { tornadoChartMethods } from '../charts/tornado-chart.js';
import { calculateDatacenterBreakEven, runDatacenterTornado } from '../../model/datacenter/index.js';
import { econRow } from '../renderers/markup.js';
import { fixed, money, midSentence } from './format.js';

export function renderBreakEven(breakEven) {
  if (!breakEven || breakEven.breakEvenPrice === null) {
    return econRow('Break-even price', 'n/a (nothing sold)');
  }
  const rows = [
    econRow(`Current ${midSentence(breakEven.label)}`, `${fixed(breakEven.currentPrice, 2)} ${breakEven.unit}`),
    econRow(
      `Break-even ${midSentence(breakEven.label)}`,
      breakEven.positiveAtZeroPrice ? 'NPV > 0 even at a zero price' : `${fixed(breakEven.breakEvenPrice, 2)} ${breakEven.unit}`,
      breakEven.breakEvenPrice <= breakEven.currentPrice ? 'positive' : 'warning',
      'The revenue price at which project NPV = 0, everything else unchanged. NPV is linear in the price, so two model runs give it exactly.',
    ),
  ];
  if (Number.isFinite(breakEven.ratioToCurrent)) rows.push(econRow('Break-even / current', `${fixed(breakEven.ratioToCurrent, 2)}×`));
  if (Number.isFinite(breakEven.npvPerUnitPrice)) rows.push(econRow('NPV per +1 price unit', money(breakEven.npvPerUnitPrice)));
  return rows.join('');
}

export const datacenterSensitivityMethods = {
  ...tornadoChartMethods,

  /** Hook read by the shared tornado chart. */
  runTornadoModel(state) {
    return runDatacenterTornado(state);
  },

  updateSensitivityCharts(r) {
    if (!r) return;
    this.updateTornadoChart(r);
    const target = document.getElementById('breakEvenRows');
    if (target) {
      try {
        target.innerHTML = renderBreakEven(calculateDatacenterBreakEven(r.state, { baseResult: r }));
      } catch (error) {
        console.warn('Break-even calculation failed', error);
        target.innerHTML = '';
      }
    }
  },
};
