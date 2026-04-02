/* Shared calculation runtime file order */

const CALCULATION_RUNTIME_SCRIPT_PATHS = [
  'js/solar-geometry.js',
  'js/reference-data.js',
  'js/module-registry.js',
  'js/exploratory-routes.js',
  'js/state-schema.js',
  'js/calculations/calculations-core.js',
  'js/calculations/calculations-solar.js',
  'js/calculations/calculations-battery.js',
  'js/calculations/calculations-series-ai.js',
  'js/calculations/calculations-process.js',
  'js/calculations/calculations-economics.js',
];

function getWorkerCalculationRuntimeScriptPaths(query = '') {
  return CALCULATION_RUNTIME_SCRIPT_PATHS.map(path => {
    const workerPath = path.replace(/^js\//, '');
    return query ? `${workerPath}${query}` : workerPath;
  });
}
