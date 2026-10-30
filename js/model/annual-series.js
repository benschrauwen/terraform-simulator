/* ============================================
   Annual solar series
   ============================================
   Builds the hour-by-hour solar series used for annual dispatch (Earth: 365
   simulated days; Mars: seasonal sols over an orbit; Moon: repeated cycle)
   and the resampling / aggregation helpers for daily and average-cycle views. */

import { PLANETARY_BODIES } from '../data/reference-data.js';
import { SolarGeometry } from './solar-geometry.js';

export const annualSeriesMethods = {
  scaleRawSeriesToAnnualEnergy(rawSeries, annualKWhTarget, peakKW) {
    if (!Array.isArray(rawSeries) || !rawSeries.length || !Number.isFinite(annualKWhTarget) || annualKWhTarget <= 0 || !Number.isFinite(peakKW) || peakKW <= 0) {
      return Array.isArray(rawSeries) ? rawSeries.map(() => 0) : [];
    }

    const safeSeries = rawSeries.map(value => Math.max(0, Number(value) || 0));
    const maxRaw = Math.max(...safeSeries, 0);
    if (maxRaw <= 0) return safeSeries.map(() => 0);

    const producedAt = scale => safeSeries.reduce((sum, value) => sum + Math.min(value * scale, peakKW), 0);
    let lo = 0;
    let hi = Math.max(peakKW / maxRaw, annualKWhTarget / safeSeries.reduce((sum, value) => sum + value, 0), 1e-6);

    while (producedAt(hi) < annualKWhTarget && hi < 1e9) {
      hi *= 2;
    }

    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (producedAt(mid) < annualKWhTarget) lo = mid;
      else hi = mid;
    }

    const scale = (lo + hi) / 2;
    return safeSeries.map(value => Math.min(value * scale, peakKW));
  },

  aggregateSeriesByWindow(series, windowSize) {
    if (!Array.isArray(series) || !series.length || !Number.isFinite(windowSize) || windowSize <= 0) return [];
    const output = [];
    for (let start = 0; start < series.length; start += windowSize) {
      output.push(series.slice(start, start + windowSize).reduce((sum, value) => sum + value, 0));
    }
    return output;
  },

  averageHourlyByWindow(series, windowSize) {
    if (!Array.isArray(series) || !series.length || !Number.isFinite(windowSize) || windowSize <= 0) return [];
    const output = new Array(windowSize).fill(0);
    const counts = new Array(windowSize).fill(0);
    series.forEach((value, index) => {
      const bucket = index % windowSize;
      output[bucket] += value;
      counts[bucket] += 1;
    });
    return output.map((value, index) => counts[index] > 0 ? value / counts[index] : 0);
  },

  aggregateSeriesBySpanHours(series, spanHours) {
    if (!Array.isArray(series) || !series.length || !Number.isFinite(spanHours) || spanHours <= 0) return [];
    const epsilon = 1e-9;
    const totalHours = series.length;
    const windowCount = Math.max(1, Math.ceil((totalHours / spanHours) - epsilon));
    const output = new Array(windowCount).fill(0);
    let bucket = 0;
    let bucketEnd = spanHours;

    for (let hour = 0; hour < totalHours; hour++) {
      const value = Number(series[hour]) || 0;
      let segmentStart = hour;
      const segmentEnd = hour + 1;

      while (segmentStart < segmentEnd - epsilon && bucket < windowCount) {
        while (bucket < windowCount && bucketEnd <= segmentStart + epsilon) {
          bucket += 1;
          bucketEnd = (bucket + 1) * spanHours;
        }
        if (bucket >= windowCount) break;

        const overlapEnd = Math.min(segmentEnd, bucketEnd);
        const overlapHours = overlapEnd - segmentStart;
        if (overlapHours > epsilon) {
          output[bucket] += value * overlapHours;
        }
        segmentStart = overlapEnd;
      }
    }

    return output;
  },

  accumulateSeriesStepBySpanHours(output, spanHours, stepIndex, value) {
    if (!Array.isArray(output) || !output.length || !Number.isFinite(spanHours) || spanHours <= 0 || !Number.isFinite(stepIndex)) {
      return;
    }

    const epsilon = 1e-9;
    const safeValue = Number(value) || 0;
    let segmentStart = stepIndex;
    const segmentEnd = stepIndex + 1;
    let bucket = Math.max(0, Math.floor(segmentStart / spanHours));
    let bucketEnd = (bucket + 1) * spanHours;

    while (segmentStart < segmentEnd - epsilon && bucket < output.length) {
      while (bucket < output.length && bucketEnd <= segmentStart + epsilon) {
        bucket += 1;
        bucketEnd = (bucket + 1) * spanHours;
      }
      if (bucket >= output.length) break;

      const overlapEnd = Math.min(segmentEnd, bucketEnd);
      const overlapHours = overlapEnd - segmentStart;
      if (overlapHours > epsilon) {
        output[bucket] += safeValue * overlapHours;
      }
      segmentStart = overlapEnd;
    }
  },

  averageSeriesByCyclePhase(series, cycleHours, binCount) {
    if (!Array.isArray(series) || !series.length || !Number.isFinite(cycleHours) || cycleHours <= 0 || !Number.isFinite(binCount) || binCount <= 0) {
      return [];
    }

    const safeBinCount = Math.max(1, Math.round(binCount));
    const sums = new Array(safeBinCount).fill(0);
    const counts = new Array(safeBinCount).fill(0);
    series.forEach((value, index) => {
      const phase = ((index + 0.5) / cycleHours) % 1;
      const bucket = Math.max(0, Math.min(safeBinCount - 1, Math.floor(phase * safeBinCount)));
      sums[bucket] += value;
      counts[bucket] += 1;
    });
    return sums.map((value, index) => counts[index] > 0 ? value / counts[index] : 0);
  },

  getAnnualWindowLabelPrefix(bodyKey) {
    if (bodyKey === 'earth') return 'Day';
    const body = this.getBodyConfig(bodyKey);
    if ((body.cycleUnitCompact || '').toLowerCase() === 'sol') return 'Sol';
    if ((body.cycleUnitCompact || '').toLowerCase() === 'day') return 'Day';
    return 'Cycle';
  },

  buildAnnualWindowLabels(bodyKey, windowCount, spanHours, totalHours) {
    if (!Number.isFinite(windowCount) || windowCount <= 0) return [];
    if (bodyKey === 'earth') {
      return Array.from({ length: windowCount }, (_, index) => SolarGeometry.dayToDateString(index + 1));
    }

    const coveredBeforeLast = Math.max(0, windowCount - 1) * spanHours;
    const lastWindowHours = Math.max(0, totalHours - coveredBeforeLast);
    const hasPartialLastWindow = windowCount > 0 && lastWindowHours < spanHours - 1e-6;
    const labelPrefix = this.getAnnualWindowLabelPrefix(bodyKey);
    return Array.from({ length: windowCount }, (_, index) => {
      const partialSuffix = hasPartialLastWindow && index === windowCount - 1 ? ' (partial)' : '';
      return `${labelPrefix} ${index + 1}${partialSuffix}`;
    });
  },

  sampleRepeatingProfileByHour(profile, cycleHours, totalHours) {
    if (!Array.isArray(profile) || !profile.length || !Number.isFinite(cycleHours) || cycleHours <= 0 || !Number.isFinite(totalHours) || totalHours <= 0) {
      return [];
    }

    const epsilon = 1e-9;
    const binCount = profile.length;
    const binHours = cycleHours / binCount;
    const hourCount = Math.max(1, Math.round(totalHours));

    return Array.from({ length: hourCount }, (_, hour) => {
      let value = 0;
      let segmentStart = hour;
      const segmentEnd = hour + 1;

      while (segmentStart < segmentEnd - epsilon) {
        let cyclePos = segmentStart % cycleHours;
        if (cyclePos < 0) cyclePos += cycleHours;
        if (cyclePos >= cycleHours - epsilon) cyclePos = 0;

        const binPhase = Math.max(0, Math.min(cycleHours - epsilon, cyclePos + epsilon));
        const bin = Math.max(0, Math.min(binCount - 1, Math.floor(binPhase / binHours)));
        const binEnd = Math.min(cycleHours, (bin + 1) * binHours);
        const overlapEnd = Math.min(segmentEnd, segmentStart + (binEnd - cyclePos));
        const overlapHours = overlapEnd - segmentStart;
        if (overlapHours > epsilon) {
          value += (Number(profile[bin]) || 0) * overlapHours;
        }
        segmentStart = overlapEnd;
      }

      return value;
    });
  },

  sampleProfileSequenceByHour(profiles, cycleHours, totalHours) {
    if (!Array.isArray(profiles) || !profiles.length || !Number.isFinite(cycleHours) || cycleHours <= 0 || !Number.isFinite(totalHours) || totalHours <= 0) {
      return [];
    }

    const epsilon = 1e-9;
    const hourCount = Math.max(1, Math.round(totalHours));
    const profileCount = profiles.length;

    return Array.from({ length: hourCount }, (_, hour) => {
      let value = 0;
      let segmentStart = hour;
      const segmentEnd = hour + 1;

      while (segmentStart < segmentEnd - epsilon) {
        const cycleIndex = Math.max(0, Math.min(profileCount - 1, Math.floor((segmentStart + epsilon) / cycleHours)));
        const profile = Array.isArray(profiles[cycleIndex]) && profiles[cycleIndex].length ? profiles[cycleIndex] : [0];
        const binCount = profile.length;
        const binHours = cycleHours / binCount;
        const cycleStart = cycleIndex * cycleHours;
        let cyclePos = segmentStart - cycleStart;
        if (cyclePos < 0) cyclePos = 0;
        if (cyclePos >= cycleHours - epsilon) cyclePos = 0;

        const binPhase = Math.max(0, Math.min(cycleHours - epsilon, cyclePos + epsilon));
        const bin = Math.max(0, Math.min(binCount - 1, Math.floor(binPhase / binHours)));
        const binEnd = Math.min(cycleHours, (bin + 1) * binHours);
        const overlapEnd = Math.min(segmentEnd, cycleStart + binEnd);
        const overlapHours = overlapEnd - segmentStart;
        if (overlapHours > epsilon) {
          value += (Number(profile[bin]) || 0) * overlapHours;
        }
        segmentStart = overlapEnd;
      }

      return value;
    });
  },

  buildAnnualSolarSeries(state, solar, options = {}) {
    const includeWindowSummaries = options.includeWindowSummaries !== false;
    const bodyKey = state.body || 'earth';
    const body = this.getBodyConfig(bodyKey);
    const annualKWhTarget = Math.max(0, (solar.annualMWh || 0) * 1000);
    const peakKW = Math.max(0, solar.peakPowerKW || 0);

    if (bodyKey === 'earth') {
      const rawHourly = [];
      for (let day = 1; day <= 365; day++) {
        const geo = SolarGeometry.dailyProfile(state.latitude, day, state.mountingType);
        geo.rawProfile.forEach(value => rawHourly.push(Math.max(0, value)));
      }
      const hourlyKW = this.scaleRawSeriesToAnnualEnergy(rawHourly, annualKWhTarget, peakKW);
      const windowHours = 24;
      const totalKWh = hourlyKW.reduce((sum, value) => sum + value, 0);
      return {
        bodyKey,
        hourlyKW,
        dayLabels: includeWindowSummaries ? this.buildAnnualWindowLabels(bodyKey, 365, windowHours, hourlyKW.length) : [],
        dailyKWh: includeWindowSummaries ? this.aggregateSeriesByWindow(hourlyKW, windowHours) : [],
        averageDayKW: includeWindowSummaries ? this.averageHourlyByWindow(hourlyKW, windowHours) : [],
        totalKWh,
        windowHours,
        windowBinCount: 24,
        seasonalVariation: true,
      };
    }

    const cycleHours = Math.max(1e-6, body.cycleHours || 24);
    const binCount = Math.max(1, solar.hourlyProfile.length);
    const totalHours = 24 * 365;

    if (bodyKey === 'mars') {
      return this.buildMarsSeasonalSolarSeries(state, solar, totalHours, annualKWhTarget, options);
    }

    const normalized = this.sampleRepeatingProfileByHour(solar.hourlyProfile, cycleHours, totalHours);
    const hourlyKW = this.scaleRawSeriesToAnnualEnergy(normalized, annualKWhTarget, peakKW);
    const windowCount = Math.ceil(hourlyKW.length / cycleHours);
    const totalKWh = hourlyKW.reduce((sum, value) => sum + value, 0);
    return {
      bodyKey,
      hourlyKW,
      dayLabels: includeWindowSummaries ? this.buildAnnualWindowLabels(bodyKey, windowCount, cycleHours, hourlyKW.length) : [],
      dailyKWh: includeWindowSummaries ? this.aggregateSeriesBySpanHours(hourlyKW, cycleHours) : [],
      averageDayKW: includeWindowSummaries ? this.averageSeriesByCyclePhase(hourlyKW, cycleHours, binCount) : [],
      totalKWh,
      windowHours: cycleHours,
      windowBinCount: binCount,
      seasonalVariation: false,
    };
  },

  buildMarsSeasonalSolarSeries(state, solar, totalHours, seriesKWhTarget, options = {}) {
    const includeWindowSummaries = options.includeWindowSummaries !== false;
    const bodyKey = 'mars';
    const body = this.getBodyConfig(bodyKey);
    const cycleHours = Math.max(1e-6, body.cycleHours || 24.66);
    const safeTotalHours = Math.max(1, Math.round(Number(totalHours) || 0));
    const binCount = Math.max(1, solar.hourlyProfile.length);
    const peakKW = Math.max(0, solar.peakPowerKW || 0);
    const cycleCount = Math.max(1, Math.ceil((safeTotalHours / cycleHours) - 1e-9));
    const dailyProfiles = Array.from({ length: cycleCount }, (_, index) => {
      const geo = SolarGeometry.planetaryDailyProfile({
        latitude: state.latitude,
        ...PLANETARY_BODIES.mars.orbit,
        seasonalDay: index + 1,
        cycleHours,
        bins: binCount,
      });
      return SolarGeometry.applyMountingShape(geo.rawProfile, state.mountingType, cycleHours).rawProfile;
    });
    const normalized = this.sampleProfileSequenceByHour(dailyProfiles, cycleHours, safeTotalHours);
    const hourlyKW = this.scaleRawSeriesToAnnualEnergy(normalized, Math.max(0, Number(seriesKWhTarget) || 0), peakKW);
    const windowCount = Math.ceil(hourlyKW.length / cycleHours);
    const totalKWh = hourlyKW.reduce((sum, value) => sum + value, 0);

    return {
      bodyKey,
      hourlyKW,
      dayLabels: includeWindowSummaries ? this.buildAnnualWindowLabels(bodyKey, windowCount, cycleHours, hourlyKW.length) : [],
      dailyKWh: includeWindowSummaries ? this.aggregateSeriesBySpanHours(hourlyKW, cycleHours) : [],
      averageDayKW: includeWindowSummaries ? this.averageSeriesByCyclePhase(hourlyKW, cycleHours, binCount) : [],
      totalKWh,
      windowHours: cycleHours,
      windowBinCount: binCount,
      seasonalVariation: true,
    };
  },

  buildMarsOrbitalDispatchBasis(state, solar, options = {}) {
    const body = this.getBodyConfig('mars');
    const orbitalSols = body.orbit.orbitalDays;
    const annualizationFactor = Math.max(1e-9, Math.max(body.cyclesPerEarthYear || 0, 1) / orbitalSols);
    return {
      solar: this.buildMarsSeasonalSolarSeries(
        state,
        solar,
        orbitalSols * Math.max(1e-6, body.cycleHours || 24.66),
        Math.max(0, (solar.annualMWh || 0) * 1000) / annualizationFactor,
        options
      ),
      annualizationFactor,
      horizonLabel: 'orbital-year',
    };
  },

  getAnnualDispatchBasis(state, solar, annualSolar, options = {}) {
    if ((state.body || 'earth') === 'mars') return this.buildMarsOrbitalDispatchBasis(state, solar, options);
    return {
      solar: annualSolar,
      annualizationFactor: 1,
      horizonLabel: 'earth-year',
    };
  },
};
