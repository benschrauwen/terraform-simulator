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
     revenue_y     = GPU-hours x price x (1 - decline)^age_y x operating fraction_y
     IT capex      = GPUs x capex per GPU, replaced every GPU life

   age_y is the age, at the middle of year y's operating period, of the
   fleet then in service. The first fleet is bought at energization (or at
   notice-to-proceed with itCapexTiming 'ntp', so it ages while the site is
   built); each replacement, every GPU life after energization, buys the
   then-current generation at the same $/GPU and rents it at the platform's
   new-GPU price again (age resets): a technology treadmill in real terms.
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

/**
 * Rental-price factor (1 - decline)^age for project year `year` (1-based),
 * given energization at t0 years; 1 outside gpu-rental mode or when the
 * year has no operation.
 */
export function getRentalPriceFactor(state, year, t0) {
  if (state.revenueBasis !== 'gpu-rental') return 1;
  const start = Math.max(year - 1, t0);
  if (start >= year) return 1;
  const middle = (start + year) / 2;
  const life = state.gpuLifeYears;
  const fleet = Math.floor((middle - t0) / life);
  const boughtAt = fleet > 0 ? t0 + fleet * life : (state.itCapexTiming === 'ntp' ? 0 : t0);
  return Math.pow(1 - state.gpuPriceDeclinePercentPerYear / 100, middle - boughtAt);
}
