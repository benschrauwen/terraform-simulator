/* GPU platform options for the GPU-rental business model: select labels and the info block
   (typical rental price, IT power and capex per GPU from js/data/datacenter/gpu.js). */

import { GPU_PLATFORMS } from '../../data/datacenter/gpu.js';

export function getGpuPlatforms() {
  return GPU_PLATFORMS;
}

/** Select options, e.g. "NVIDIA GB300 NVL72 (rack, 72 GPUs) · $5.00/GPU-hr". */
export function getGpuPlatformOptions() {
  return Object.entries(GPU_PLATFORMS).map(([value, platform]) => ({
    value,
    label: `${platform.label} · $${platform.rentalPricePerGpuHour.toFixed(2)}/GPU-hr`,
  }));
}
