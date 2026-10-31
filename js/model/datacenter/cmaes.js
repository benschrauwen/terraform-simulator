/* ============================================
   CMA-ES: a small, deterministic minimizer for the design optimizer
   ============================================
   Covariance Matrix Adaptation Evolution Strategy, (mu/mu_w, lambda) with
   rank-one and rank-mu covariance updates and cumulative step-size
   adaptation, following Hansen, "The CMA Evolution Strategy: A Tutorial"
   (arXiv:1604.00772, 2016/2023), default parameters. It only ranks
   candidates, so the jumps in NPV where a firm unit is added or removed do
   not mislead it, and it learns the direction of a ridge (cheap solar and
   batteries: "less solar, more battery"), where an axis-by-axis pattern
   search stalls.

   minimizeCmaes({ f, x0, sigma0, maxEvals, rng, tolX, lambda }) minimizes
   f over the unit box [0, 1]^n (samples outside are clamped to it and the
   clamped point is used in the update), from mean x0 with step sigma0, and
   stops when the step is below tolX in every coordinate, when the budget
   of f evaluations is spent, or after `stallGenerations` generations
   without a better point. Deterministic for a given rng (createRng(seed)).
   Returns { x, fx, evaluations, generations }. Pure; no DOM. */

/** Seeded uniform [0, 1) generator (mulberry32). */
export function createRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal from a uniform rng (Box-Muller). */
function gaussian(rng) {
  let u = 0;
  while (u <= 1e-12) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Eigen-decomposition of a small symmetric matrix (cyclic Jacobi): { values, vectors (columns) }. */
export function symmetricEigen(matrix) {
  const n = matrix.length;
  const a = matrix.map(row => row.slice());
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => Math.max(row[i], 1e-30)), vectors: v };
}

const clamp01 = value => Math.min(1, Math.max(0, value));

export function minimizeCmaes({ f, x0, sigma0 = 0.2, maxEvals = 300, rng = createRng(1), tolX = 1e-3, lambda: lambdaOption = null, stallGenerations = 12 }) {
  const n = x0.length;
  const lambda = lambdaOption ?? 4 + Math.floor(3 * Math.log(n));
  const mu = Math.floor(lambda / 2);
  const rawWeights = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const weightSum = rawWeights.reduce((sum, w) => sum + w, 0);
  const weights = rawWeights.map(w => w / weightSum);
  const muEff = 1 / weights.reduce((sum, w) => sum + w * w, 0);
  const cSigma = (muEff + 2) / (n + muEff + 5);
  const dSigma = 1 + 2 * Math.max(0, Math.sqrt((muEff - 1) / (n + 1)) - 1) + cSigma;
  const cC = (4 + muEff / n) / (n + 4 + (2 * muEff) / n);
  const c1 = 2 / ((n + 1.3) ** 2 + muEff);
  const cMu = Math.min(1 - c1, (2 * (muEff - 2 + 1 / muEff)) / ((n + 2) ** 2 + muEff));
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));

  let mean = x0.map(clamp01);
  let sigma = sigma0;
  let C = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  let pSigma = new Array(n).fill(0);
  let pC = new Array(n).fill(0);
  let best = { x: mean.slice(), fx: f(mean) };
  let evaluations = 1;
  let generations = 0;
  let stall = 0;

  while (evaluations + lambda <= maxEvals) {
    const { values, vectors } = symmetricEigen(C);
    const D = values.map(Math.sqrt);
    // B D z: a sample's step in the original coordinates.
    const step = z => Array.from({ length: n }, (_, i) => vectors[i].reduce((sum, b, k) => sum + b * D[k] * z[k], 0));
    const offspring = [];
    for (let k = 0; k < lambda; k++) {
      const z = Array.from({ length: n }, () => gaussian(rng));
      const x = mean.map((m, i) => clamp01(m + sigma * step(z)[i]));
      offspring.push({ x, fx: f(x) });
      evaluations += 1;
    }
    offspring.sort((a, b) => a.fx - b.fx);
    generations += 1;
    if (offspring[0].fx < best.fx - 1e-9 * Math.max(1, Math.abs(best.fx))) {
      best = { x: offspring[0].x.slice(), fx: offspring[0].fx };
      stall = 0;
    } else {
      stall += 1;
    }
    const oldMean = mean;
    mean = Array.from({ length: n }, (_, i) => weights.reduce((sum, w, k) => sum + w * offspring[k].x[i], 0));
    const y = Array.from({ length: n }, (_, i) => (mean[i] - oldMean[i]) / sigma);
    // C^(-1/2) y = B D^-1 B' y.
    const bty = Array.from({ length: n }, (_, k) => vectors.reduce((sum, row, i) => sum + row[k] * y[i], 0));
    const invSqrtY = Array.from({ length: n }, (_, i) => vectors[i].reduce((sum, b, k) => sum + b * bty[k] / D[k], 0));
    pSigma = pSigma.map((p, i) => (1 - cSigma) * p + Math.sqrt(cSigma * (2 - cSigma) * muEff) * invSqrtY[i]);
    const pSigmaNorm = Math.sqrt(pSigma.reduce((sum, p) => sum + p * p, 0));
    const hSigma = pSigmaNorm / Math.sqrt(1 - (1 - cSigma) ** (2 * generations)) < (1.4 + 2 / (n + 1)) * chiN ? 1 : 0;
    pC = pC.map((p, i) => (1 - cC) * p + hSigma * Math.sqrt(cC * (2 - cC) * muEff) * y[i]);
    const steps = offspring.slice(0, mu).map(o => o.x.map((xi, i) => (xi - oldMean[i]) / sigma));
    C = C.map((row, i) => row.map((cij, j) => {
      const rankMu = steps.reduce((sum, s, k) => sum + weights[k] * s[i] * s[j], 0);
      return (1 - c1 - cMu) * cij + c1 * (pC[i] * pC[j] + (1 - hSigma) * cC * (2 - cC) * cij) + cMu * rankMu;
    }));
    sigma *= Math.exp((cSigma / dSigma) * (pSigmaNorm / chiN - 1));
    sigma = Math.min(sigma, 1);
    const spread = sigma * Math.sqrt(Math.max(...symmetricEigen(C).values));
    if (spread < tolX || stall >= stallGenerations) break;
  }
  return { x: best.x, fx: best.fx, evaluations, generations };
}
