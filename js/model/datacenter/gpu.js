/* ============================================
   GPU cloud rental
   ============================================
   The default business model: the operator owns the GPUs and rents them by
   the GPU-hour (platform data in data/datacenter/gpu.js).

     GPUs          = IT capacity kW / IT kW per GPU   (fractional: results
                     scale linearly; the UI can round it for display)
     IT draw       = IT capacity x (occupancy x rentedLoadFraction
                                    + (1 - occupancy) x idleLoadFraction)
                     (replaces itUtilizationPercent in this mode)
     GPU-hours     = GPUs x 8760 x occupancy x served share of IT energy
     revenue_y     = GPU-hours x price x R_y
     R_y           = integral over the operating time of year y of
                     (1 - decline)^(age of the fleet in service at t) dt
     IT capex      = GPUs x capex per GPU, replaced every GPU life

   Time is continuous within the annual grid: project year y covers
   (y - 1, y]; operation starts at energization t0 (years after close), so
   the first year earns only its share after t0. Fleet k serves from
   t0 + k x life to t0 + (k + 1) x life, a year being split at the
   replacement point. The first fleet is bought at energization (or at
   notice-to-proceed with itCapexTiming 'ntp', so it ages while the site is
   built); each replacement buys the then-current generation at the same
   $/GPU and rents it at the platform's new-GPU price again (age resets):
   a technology treadmill in real terms. With q = 1 - decline,
     integral_a^b q^(t - p) dt = (q^(b - p) - q^(a - p)) / ln q   (= b - a when q = 1)
   so revenue moves smoothly with the first-power date.
   Pure; no DOM. */

import { GPU_PLATFORMS, GPU_RENTAL_DEFAULTS } from '../../data/datacenter/gpu.js';

/** IT draw as a share of IT nameplate (0-1) for the state's business model. */
export function getItLoadFraction(state) {
  if (state.revenueBasis !== 'gpu-rental') return state.itUtilizationPercent / 100;
  const occupancy = state.gpuOccupancyPercent / 100;
  return occupancy * GPU_RENTAL_DEFAULTS.rentedLoadFraction + (1 - occupancy) * GPU_RENTAL_DEFAULTS.idleLoadFraction;
}

/** The GPU fleet, or { enabled: false } outside gpu-rental mode. */
export function getGpuFleet(state) {
  if (state.revenueBasis !== 'gpu-rental') return { enabled: false, count: 0 };
  const platform = GPU_PLATFORMS[state.gpuPlatform];
  return {
    enabled: true,
    platform: state.gpuPlatform,
    label: platform.label,
    count: (state.itCapacityMW * 1000) / state.gpuItKWPerGpu,
    itKWPerGpu: state.gpuItKWPerGpu,
    capexPerGpu: state.gpuCapexPerGpu,
    rentalPricePerHour: state.gpuRentalPricePerHour,
    occupancyPercent: state.gpuOccupancyPercent,
    priceDeclinePercentPerYear: state.gpuPriceDeclinePercentPerYear,
    lifeYears: state.gpuLifeYears,
    itLoadFraction: getItLoadFraction(state),
    marketIndex: platform.marketIndex,
    ownerTcoPerGpuHour: platform.ownerTcoPerGpuHour,
  };
}

/* integral_from^to q^(t - boughtAt) dt, in years. */
function integratePriceFactor(q, from, to, boughtAt) {
  if (!(to > from)) return 0;
  if (q >= 1) return to - from;
  if (q <= 0) return 0;
  return (Math.pow(q, to - boughtAt) - Math.pow(q, from - boughtAt)) / Math.log(q);
}

/**
 * Rental revenue factor R_y of project year `year` (1-based), given
 * energization at t0 years: the operating time within (year - 1, year], in
 * years, weighted at each instant by the rental-price factor
 * (1 - decline)^age of the fleet then in service. Outside gpu-rental mode
 * it is the plain operating fraction clamp(year - t0, 0, 1).
 */
export function getRentalRevenueFactor(state, year, t0) {
  const start = Math.max(year - 1, t0);
  if (start >= year) return 0;
  if (state.revenueBasis !== 'gpu-rental') return year - start;
  const q = 1 - state.gpuPriceDeclinePercentPerYear / 100;
  const life = state.gpuLifeYears;
  let total = 0;
  for (let k = Math.max(0, Math.floor((start - t0) / life) - 1); t0 + k * life < year; k++) {
    const boughtAt = k > 0 ? t0 + k * life : (state.itCapexTiming === 'ntp' ? 0 : t0);
    total += integratePriceFactor(q, Math.max(start, t0 + k * life), Math.min(year, t0 + (k + 1) * life), boughtAt);
  }
  return total;
}

/**
 * Average rental-price factor over the operating time of project year
 * `year` (R_y / operating fraction); 1 outside gpu-rental mode or when the
 * year has no operation.
 */
export function getRentalPriceFactor(state, year, t0) {
  if (state.revenueBasis !== 'gpu-rental') return 1;
  const operating = Math.max(0, Math.min(1, year - t0));
  return operating > 0 ? getRentalRevenueFactor(state, year, t0) / operating : 1;
}
