import assert from 'node:assert/strict';
import test from 'node:test';

import { Diagram } from '../../js/ui/diagram.js';

test('diagram formats process cards and connector labels with peak and average hourly rates', () => {
  assert.equal(Diagram.formatInstalledPowerKW(106981), 'Peak 107 MW');
  assert.equal(Diagram.formatMassRate(5732), 'Peak 5.7 t/h');
  assert.equal(
    Diagram.formatExploratoryPeakOutput(
      { outputDailyUnits: 54, capexSizingOutputUnitsPerHour: 1.9, peakOutputUnitsPerHour: 2.3, outputUnit: 't' },
      { solar: { cycleHours: 24 } }
    ),
    'Peak 1.9 t/h'
  );
  assert.equal(
    Diagram.formatExploratoryPeakOutput(
      { outputDailyUnits: 54, peakOutputUnitsPerHour: 2.3, outputUnit: 't' },
      { solar: { cycleHours: 24 } }
    ),
    'Peak 2.3 t/h'
  );
  assert.equal(Diagram.formatAveragePowerFromCycleKWh(590400, 24), 'Avg 24.6 MW');
  assert.equal(Diagram.formatAverageMassFlow(14855, 24, 'H2'), 'Avg 619 kg H2/h');
  assert.equal(Diagram.formatAverageMassFlow(107993, 24, 'CO2'), 'Avg 4.5 t CO2/h');
  assert.equal(Diagram.formatAverageMassFlow(78600, 24, 'MeOH'), 'Avg 3.3 t MeOH/h');
});
