/* ============================================
   Solar Geometry — Accurate Sun Position Model
   ============================================
   Computes solar irradiance profiles based on actual
   sun position (declination, hour angle, elevation)
   for any latitude and day of year.
*/

/* en-US one-decimal formatting (matches the UI's FormatNumbers.fixed). */
function formatOneDecimal(value) {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export const SolarGeometry = {

  DEG: Math.PI / 180,

  TAU: 2 * Math.PI,

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },

  dot(a, b) {
    return (a.east * b.east) + (a.north * b.north) + (a.up * b.up);
  },

  normalizeVec(vec) {
    const magnitude = Math.hypot(vec.east, vec.north, vec.up);
    if (!isFinite(magnitude) || magnitude <= 0) {
      return { east: 0, north: 0, up: 1 };
    }
    return {
      east: vec.east / magnitude,
      north: vec.north / magnitude,
      up: vec.up / magnitude,
    };
  },

  wrapRadians(angle) {
    const wrapped = angle % this.TAU;
    return wrapped < 0 ? wrapped + this.TAU : wrapped;
  },

  wrapDegrees(angle) {
    const wrapped = angle % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
  },

  wrappedPhaseOffset(phase, center) {
    return ((((phase - center) % 1) + 1.5) % 1) - 0.5;
  },

  gaussianWrappedPhase(phase, center, width) {
    const safeWidth = Math.max(1e-6, width || 0);
    const delta = this.wrappedPhaseOffset(phase, center);
    return Math.exp(-0.5 * Math.pow(delta / safeWidth, 2));
  },

  getCyclicSegments(values, isActive) {
    if (!Array.isArray(values) || !values.length || typeof isActive !== 'function') return [];

    const segments = [];
    let start = -1;
    for (let i = 0; i < values.length; i++) {
      const active = Boolean(isActive(values[i], i, values));
      if (active) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        segments.push({ start, endExclusive: i, lengthBins: i - start, wraps: false });
        start = -1;
      }
    }

    if (start >= 0) {
      segments.push({
        start,
        endExclusive: values.length,
        lengthBins: values.length - start,
        wraps: false,
      });
    }

    if (segments.length > 1 && segments[0].start === 0 && segments[segments.length - 1].endExclusive === values.length) {
      const first = segments[0];
      const last = segments.pop();
      segments[0] = {
        start: last.start,
        endExclusive: first.endExclusive,
        lengthBins: first.lengthBins + last.lengthBins,
        wraps: true,
      };
    }

    return segments;
  },

  rotateProfile(rawProfile, startIndex = 0) {
    if (!Array.isArray(rawProfile) || rawProfile.length === 0) return [];
    const n = rawProfile.length;
    const offset = ((Math.round(startIndex) % n) + n) % n;
    if (offset === 0) return [...rawProfile];
    return rawProfile.slice(offset).concat(rawProfile.slice(0, offset));
  },

  sunVectorLocal(latRad, declRad, hourAngleRad) {
    return {
      east: Math.cos(declRad) * Math.sin(hourAngleRad),
      north: (Math.cos(latRad) * Math.sin(declRad)) - (Math.sin(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad)),
      up: (Math.sin(latRad) * Math.sin(declRad)) + (Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad)),
    };
  },

  panelNormal(tiltDeg, azimuthDeg) {
    const tilt = tiltDeg * this.DEG;
    const azimuth = azimuthDeg * this.DEG;
    return {
      east: Math.sin(tilt) * Math.sin(azimuth),
      north: Math.sin(tilt) * Math.cos(azimuth),
      up: Math.cos(tilt),
    };
  },

  trackerNormal(sunVec) {
    return this.normalizeVec({
      east: sunVec.east,
      north: 0,
      up: sunVec.up,
    });
  },

  /* Mounting geometry shared by every body. East-west racks are low-tilt
     (PEG-style); single-axis trackers rotate about a horizontal north-south
     axis within +/-60 deg and backtrack to avoid row-to-row shading. */
  EAST_WEST_TILT_DEG: 8,
  TRACKER_ROTATION_LIMIT_DEG: 60,
  GROUND_ALBEDO: 0.2,

  /* Hay-Davies transposition: beam on the plane; sky diffuse split into a
     circumsolar part (anisotropy index A = DNI / extraterrestrial DNI, treated
     like beam via Rb = cos(incidence) / cos(zenith)) and an isotropic part
     weighted by the sky view factor; plus ground-reflected light (albedo).
     Without `dniExtra` the sky is isotropic. */
  planeOfArrayIrradiance(normal, tiltDeg, sunVec, dni, dhi, ghi = 0, dniExtra = 0) {
    const cosIncidence = Math.max(0, this.dot(sunVec, normal));
    const cosTilt = Math.cos(tiltDeg * this.DEG);
    const skyView = (1 + cosTilt) / 2;
    const groundView = (1 - cosTilt) / 2;
    const anisotropy = dniExtra > 0 ? this.clamp(dni / dniExtra, 0, 1) : 0;
    const rb = cosIncidence / Math.max(sunVec.up, 0.01745);
    const skyDiffuse = dhi * ((anisotropy * rb) + ((1 - anisotropy) * skyView));
    return (dni * cosIncidence) + skyDiffuse + (this.GROUND_ALBEDO * ghi * groundView);
  },

  /* Rotation (radians, + toward east) of a horizontal N-S axis tracker:
     true tracking, backtracking when the rows would shade each other
     (flat-terrain rule, Anderson & Mikofski 2020: when cos(theta_T) < GCR,
     theta = theta_T - sign(theta_T) * acos(cos(theta_T) / GCR)), then the
     mechanical rotation limit. */
  singleAxisTrackerRotation(sunVec, groundCoverageRatio = 0) {
    let theta = Math.atan2(sunVec.east, Math.max(sunVec.up, 1e-9));
    const gcr = Number(groundCoverageRatio) || 0;
    if (gcr > 0 && gcr < 1) {
      const cosTheta = Math.cos(theta);
      if (cosTheta < gcr) {
        theta -= Math.sign(theta) * Math.acos(cosTheta / gcr);
      }
    }
    const limit = this.TRACKER_ROTATION_LIMIT_DEG * this.DEG;
    return this.clamp(theta, -limit, limit);
  },

  /* Plane-of-array irradiance (W/m2) for one mounting. `fixedTiltDeg`
     defaults to the site's modeled optimum; `fixedAzimuthDeg` defaults to
     equator-facing. */
  mountingPlaneIrradiance({
    sunVec,
    dni,
    dhi,
    ghi = 0,
    dniExtra = 0,
    latitude,
    mountingKey,
    fixedTiltDeg,
    fixedAzimuthDeg,
    groundCoverageRatio = 0,
  }) {
    if (sunVec.up <= 0) return 0;

    const poa = (normal, tiltDeg) =>
      this.planeOfArrayIrradiance(normal, tiltDeg, sunVec, dni, dhi, ghi, dniExtra);
    const eastWestTilt = this.EAST_WEST_TILT_DEG;

    if (mountingKey === 'ew') {
      const east = poa(this.panelNormal(eastWestTilt, 90), eastWestTilt);
      const west = poa(this.panelNormal(eastWestTilt, 270), eastWestTilt);
      return 0.5 * (east + west);
    }

    if (mountingKey === 'single') {
      const theta = this.singleAxisTrackerRotation(sunVec, groundCoverageRatio);
      return poa({ east: Math.sin(theta), north: 0, up: Math.cos(theta) }, Math.abs(theta) / this.DEG);
    }

    if (mountingKey === 'dual') {
      const normal = this.normalizeVec(sunVec);
      return poa(normal, Math.acos(this.clamp(normal.up, -1, 1)) / this.DEG);
    }

    const tilt = Number.isFinite(fixedTiltDeg) ? fixedTiltDeg : this.defaultFixedTiltDeg(latitude);
    const azimuth = Number.isFinite(fixedAzimuthDeg) ? fixedAzimuthDeg : (latitude >= 0 ? 180 : 0);
    return poa(this.panelNormal(tilt, azimuth), tilt);
  },

  /* Rule-of-thumb fixed tilt, used only when no modeled optimum is given. */
  defaultFixedTiltDeg(latitude) {
    return this.clamp(Math.abs(Number(latitude) || 0) * 0.85, 0, 45);
  },

  /**
   * Solar declination angle (radians) for a given day of year.
   * Uses the Spencer (1971) formula.
   */
  declination(dayOfYear) {
    const B = (dayOfYear - 1) * (2 * Math.PI / 365);
    return 0.006918
      - 0.399912 * Math.cos(B) + 0.070257 * Math.sin(B)
      - 0.006758 * Math.cos(2 * B) + 0.000907 * Math.sin(2 * B)
      - 0.002697 * Math.cos(3 * B) + 0.00148 * Math.sin(3 * B);
  },

  /**
   * Equation of time (minutes) — correction for Earth's orbital eccentricity.
   */
  equationOfTime(dayOfYear) {
    const B = (dayOfYear - 1) * (2 * Math.PI / 365);
    return 229.18 * (0.000075
      + 0.001868 * Math.cos(B) - 0.032077 * Math.sin(B)
      - 0.014615 * Math.cos(2 * B) - 0.04089 * Math.sin(2 * B));
  },

  /**
   * Sunrise/sunset hour angle (radians).
   * Returns NaN for polar night/day.
   */
  sunriseHourAngle(latRad, declRad) {
    const cosOmega = -Math.tan(latRad) * Math.tan(declRad);
    if (cosOmega > 1) return 0;      // polar night
    if (cosOmega < -1) return Math.PI; // midnight sun
    return Math.acos(cosOmega);
  },

  /**
   * Solar elevation angle (radians) at a given hour angle.
   */
  solarElevation(latRad, declRad, hourAngleRad) {
    return Math.asin(
      Math.sin(latRad) * Math.sin(declRad) +
      Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad)
    );
  },

  /**
   * Air mass for a given solar elevation angle.
   * Kasten & Young (1989) formula.
   */
  airMass(elevationDeg) {
    if (elevationDeg <= 0) return Infinity;
    return 1 / (Math.sin(elevationDeg * this.DEG) +
      0.50572 * Math.pow(elevationDeg + 6.07995, -1.6364));
  },

  /**
   * Clear-sky direct normal irradiance (W/m²) from air mass: Meinel & Meinel
   * (1976), DNI = 1353 * 0.7^(AM^0.678) (947 W/m² at AM1, 838 W/m² at AM2).
   * Seasonal Earth-Sun distance is applied separately (extraterrestrialFactor).
   */
  clearSkyDNI(airMass) {
    if (!isFinite(airMass) || airMass <= 0) return 0;
    return 1353 * Math.pow(0.7, Math.pow(airMass, 0.678));
  },

  /* Clear-sky diffuse horizontal irradiance as a share of DNI (the usual
     companion to the Meinel model: diffuse ~10% of the direct beam). */
  CLEAR_SKY_DIFFUSE_RATIO: 0.1,

  /**
   * Sky irradiance at one instant. Clear sky is Meinel DNI plus 10% diffuse;
   * `beamTransmittance` (0-1) then moves a share of the beam into isotropic
   * diffuse, conserving GHI, so a site's measured annual diffuse fraction can
   * be matched (clouds/aerosols redistribute light more than they remove it
   * on the profile shape; annual energy is scaled to the site yield anyway).
   */
  skyIrradiance(elevationDeg, etFactor = 1, beamTransmittance = 1) {
    if (!(elevationDeg > 0)) return { dni: 0, dhi: 0, ghi: 0, dniExtra: 0 };
    const sinElevation = Math.sin(elevationDeg * this.DEG);
    const dniClear = this.clearSkyDNI(this.airMass(elevationDeg)) * etFactor;
    const dhiClear = this.CLEAR_SKY_DIFFUSE_RATIO * dniClear;
    const transmittance = this.clamp(Number.isFinite(beamTransmittance) ? beamTransmittance : 1, 0, 1);
    return {
      dni: transmittance * dniClear,
      dhi: dhiClear + ((1 - transmittance) * dniClear * sinElevation),
      ghi: (dniClear * sinElevation) + dhiClear,
      dniExtra: 1361 * etFactor,
    };
  },

  /**
   * Beam transmittance that reproduces an annual diffuse fraction (DHI/GHI)
   * at a latitude. With clear-sky annual beam-on-horizontal B and diffuse D0,
   * moving (1 - t) of the beam to diffuse gives DF = (D0 + (1 - t) B) / (B + D0),
   * so t = 1 - (DF (B + D0) - D0) / B, clamped to [0, 1].
   */
  beamTransmittanceForDiffuseFraction(latitude, diffuseFraction) {
    if (!Number.isFinite(diffuseFraction)) return 1;
    const key = `${Number(latitude).toFixed(2)}|${diffuseFraction.toFixed(4)}`;
    const cache = this._beamTransmittanceCache || (this._beamTransmittanceCache = new Map());
    if (cache.has(key)) return cache.get(key);

    const latRad = latitude * this.DEG;
    let beam = 0;
    let diffuse = 0;
    for (let day = 8; day <= 365; day += 15) {
      const decl = this.declination(day);
      const etFactor = this.extraterrestrialFactor(day);
      for (let step = 0; step < 48; step++) {
        const hourAngle = (((step + 0.5) / 2) - 12) * 15 * this.DEG;
        const elevDeg = this.solarElevation(latRad, decl, hourAngle) / this.DEG;
        if (elevDeg <= 0) continue;
        const sky = this.skyIrradiance(elevDeg, etFactor, 1);
        beam += sky.dni * Math.sin(elevDeg * this.DEG);
        diffuse += sky.dhi;
      }
    }
    const transmittance = beam > 0
      ? this.clamp(1 - ((diffuseFraction * (beam + diffuse)) - diffuse) / beam, 0, 1)
      : 1;
    cache.set(key, transmittance);
    return transmittance;
  },

  /* Annual plane-of-array insolation (kWh/m2/yr) on a coarse sample grid
     (24 days x 48 half-hours), for tilt optimization. */
  sampledAnnualPlaneOfArrayKWh(latitude, mountingKey, options = {}) {
    const latRad = latitude * this.DEG;
    let total = 0;
    for (let day = 8; day <= 365; day += 15) {
      const decl = this.declination(day);
      const etFactor = this.extraterrestrialFactor(day);
      for (let step = 0; step < 48; step++) {
        const hourAngle = (((step + 0.5) / 2) - 12) * 15 * this.DEG;
        const elevDeg = this.solarElevation(latRad, decl, hourAngle) / this.DEG;
        if (elevDeg <= 0) continue;
        const sky = this.skyIrradiance(elevDeg, etFactor, options.beamTransmittance);
        total += this.mountingPlaneIrradiance({
          sunVec: this.sunVectorLocal(latRad, decl, hourAngle),
          ...sky,
          latitude,
          mountingKey,
          fixedTiltDeg: options.fixedTiltDeg,
          groundCoverageRatio: options.groundCoverageRatio,
        });
      }
    }
    // 24 sampled days, half-hour steps -> scale to 365 days of kWh.
    return (total * 0.5 * (365 / 24)) / 1000;
  },

  /* Equator-facing tilt (deg) that maximizes modeled annual POA insolation,
     by golden-section search over 0-75 deg. Cached per site. */
  optimalFixedTiltDeg(latitude, beamTransmittance = 1) {
    const key = `${Number(latitude).toFixed(2)}|${Number(beamTransmittance).toFixed(4)}`;
    const cache = this._optimalTiltCache || (this._optimalTiltCache = new Map());
    if (cache.has(key)) return cache.get(key);

    const yieldAt = tilt => this.sampledAnnualPlaneOfArrayKWh(latitude, 'fixed', { beamTransmittance, fixedTiltDeg: tilt });
    const ratio = (Math.sqrt(5) - 1) / 2;
    let lo = 0;
    let hi = 75;
    let a = hi - (ratio * (hi - lo));
    let b = lo + (ratio * (hi - lo));
    let fa = yieldAt(a);
    let fb = yieldAt(b);
    while (hi - lo > 0.25) {
      if (fa < fb) {
        lo = a; a = b; fa = fb;
        b = lo + (ratio * (hi - lo)); fb = yieldAt(b);
      } else {
        hi = b; b = a; fb = fa;
        a = hi - (ratio * (hi - lo)); fa = yieldAt(a);
      }
    }
    const tilt = Math.round((lo + hi) / 2);
    cache.set(key, tilt);
    return tilt;
  },

  /**
   * Extraterrestrial radiation factor for day of year
   * (Earth-Sun distance correction).
   */
  extraterrestrialFactor(dayOfYear) {
    const B = (dayOfYear - 1) * (2 * Math.PI / 365);
    return 1.00011 + 0.034221 * Math.cos(B) + 0.00128 * Math.sin(B)
      + 0.000719 * Math.cos(2 * B) + 0.000077 * Math.sin(2 * B);
  },

  /**
   * Generate 24-hour power profile for a specific day.
   * `options`: { beamTransmittance, fixedTiltDeg, groundCoverageRatio } (see
   * skyIrradiance / mountingPlaneIrradiance); defaults are clear sky, the
   * rule-of-thumb tilt and an unshaded tracker.
   * Returns { profile: [24 values normalized 0-1], sunrise, sunset, dayLength, peakIrradiance }
   */
  dailyProfile(latitude, dayOfYear, mountingKey = 'fixed', options = {}) {
    const latRad = latitude * this.DEG;
    const decl = this.declination(dayOfYear);
    const omegaS = this.sunriseHourAngle(latRad, decl);
    const etFactor = this.extraterrestrialFactor(dayOfYear);

    // Day length in hours
    const dayLengthHours = (2 * omegaS) / this.DEG / 15; // 15°/hour

    // Solar noon is at hour 12 (local solar time)
    const solarNoon = 12;

    // Sunrise and sunset hours
    const sunrise = solarNoon - dayLengthHours / 2;
    const sunset = solarNoon + dayLengthHours / 2;

    // Compute irradiance at each hour (using half-hour midpoints for accuracy)
    const profile = [];
    let maxIrr = 0;

    for (let h = 0; h < 24; h++) {
      // Average over sub-hour intervals for smoother profile
      let totalIrr = 0;
      const subSteps = 4;
      for (let s = 0; s < subSteps; s++) {
        const t = h + (s + 0.5) / subSteps; // sub-hour time
        const hourAngle = (t - solarNoon) * 15 * this.DEG;
        const elevation = this.solarElevation(latRad, decl, hourAngle);
        const elevDeg = elevation / this.DEG;

        if (elevDeg > 0) {
          const sunVec = this.sunVectorLocal(latRad, decl, hourAngle);
          const sky = this.skyIrradiance(elevDeg, etFactor, options.beamTransmittance);
          totalIrr += this.mountingPlaneIrradiance({
            sunVec,
            ...sky,
            latitude,
            mountingKey,
            fixedTiltDeg: options.fixedTiltDeg,
            groundCoverageRatio: options.groundCoverageRatio,
          });
        }
      }
      const avgIrr = totalIrr / subSteps;
      profile.push(avgIrr);
      if (avgIrr > maxIrr) maxIrr = avgIrr;
    }

    // Normalize to 0-1
    const sum = profile.reduce((a, b) => a + b, 0);
    const normalized = sum > 0 ? profile.map(v => v / sum) : profile.map(() => 0);

    return {
      profile: normalized,
      rawProfile: profile, // W/m² for reference
      sunrise,
      sunset,
      dayLengthHours,
      peakIrradiance: maxIrr,
      dailyInsolation: sum / 1000, // kWh/m² for this day (clear sky)
    };
  },

  /**
   * Generate annual average profile by averaging profiles across the year.
   * Samples ~12 days evenly spaced.
   */
  annualAverageProfile(latitude, mountingKey = 'fixed', options = {}) {
    const sampleDays = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
    const avgProfile = new Array(24).fill(0);
    let totalInsolation = 0;
    let totalDayLength = 0;
    let totalSunrise = 0;
    let totalSunset = 0;

    for (const day of sampleDays) {
      const result = this.dailyProfile(latitude, day, mountingKey, options);
      for (let h = 0; h < 24; h++) {
        avgProfile[h] += result.rawProfile[h];
      }
      totalInsolation += result.dailyInsolation;
      totalDayLength += result.dayLengthHours;
      totalSunrise += result.sunrise;
      totalSunset += result.sunset;
    }

    const n = sampleDays.length;
    const rawAvg = avgProfile.map(v => v / n);
    const sum = rawAvg.reduce((a, b) => a + b, 0);
    const normalized = sum > 0 ? rawAvg.map(v => v / sum) : rawAvg.map(() => 0);

    return {
      profile: normalized,
      rawProfile: rawAvg,
      sunrise: totalSunrise / n,
      sunset: totalSunset / n,
      dayLengthHours: totalDayLength / n,
      peakIrradiance: Math.max(...rawAvg),
      dailyInsolation: totalInsolation / n,
    };
  },

  normalizeProfile(rawProfile, cycleHours) {
    if (!Array.isArray(rawProfile) || rawProfile.length === 0) {
      return {
        profile: [],
        rawProfile: [],
        sunrise: 0,
        sunset: 0,
        dayLengthHours: 0,
        peakIrradiance: 0,
        dailyInsolation: 0,
      };
    }

    const sum = rawProfile.reduce((a, b) => a + b, 0);
    const normalized = sum > 0 ? rawProfile.map(v => v / sum) : rawProfile.map(() => 0);
    const peak = Math.max(...rawProfile, 0);
    const litThreshold = peak * 0.02;
    const litSegments = this.getCyclicSegments(rawProfile, value => value > litThreshold);
    const primaryLitSegment = litSegments.reduce((best, segment) =>
      (!best || segment.lengthBins > best.lengthBins ? segment : best), null);
    const totalLitBins = litSegments.reduce((sumBins, segment) => sumBins + segment.lengthBins, 0);
    const stepHours = cycleHours / rawProfile.length;
    const sunrise = primaryLitSegment ? primaryLitSegment.start * stepHours : 0;
    const sunset = primaryLitSegment ? primaryLitSegment.endExclusive * stepHours : 0;
    const dayLengthHours = totalLitBins * stepHours;

    return {
      profile: normalized,
      rawProfile,
      sunrise,
      sunset,
      dayLengthHours,
      peakIrradiance: peak,
      dailyInsolation: sum / 1000,
    };
  },

  applyMountingShape(rawProfile, mountingKey, cycleHours) {
    if (!Array.isArray(rawProfile) || rawProfile.length === 0) {
      return this.normalizeProfile([], cycleHours);
    }

    const peak = Math.max(...rawProfile, 0);
    if (peak <= 0) {
      return this.normalizeProfile(rawProfile, cycleHours);
    }

    const litThreshold = peak * 0.02;
    const firstLit = rawProfile.findIndex(v => v > litThreshold);
    const lastLit = rawProfile.length - 1 - [...rawProfile].reverse().findIndex(v => v > litThreshold);
    const daylightSpan = Math.max(1, lastLit - firstLit);

    const shaped = rawProfile.map((value, idx) => {
      if (idx < firstLit || idx > lastLit || value <= 0) return 0;

      const x = (idx - firstLit) / daylightSpan;
      let weight = 1;

      if (mountingKey === 'ew') {
        weight = 0.82 + (0.52 * Math.pow(Math.abs((2 * x) - 1), 0.75));
      } else if (mountingKey === 'single') {
        weight = 0.92 + (0.24 * Math.pow(Math.abs((2 * x) - 1), 0.9));
      } else if (mountingKey === 'dual') {
        weight = 0.90 + (0.30 * Math.pow(Math.abs((2 * x) - 1), 0.95));
      } else if (mountingKey === 'fixed') {
        weight = 0.98 + (0.06 * (1 - Math.pow(Math.abs((2 * x) - 1), 1.1)));
      }

      return value * weight;
    });

    return this.normalizeProfile(shaped, cycleHours);
  },

  planetaryDeclination(dayOfYear, orbitalDays, axialTiltDeg) {
    const tilt = axialTiltDeg * this.DEG;
    const phase = ((dayOfYear - 1) / orbitalDays) * (2 * Math.PI);
    return tilt * Math.sin(phase - (Math.PI / 2));
  },

  eccentricAnomalyFromTrueAnomaly(trueAnomalyRad, eccentricity = 0) {
    const e = Math.max(0, Math.min(0.999999, eccentricity || 0));
    if (e <= 1e-9) return this.wrapRadians(trueAnomalyRad);
    const numerator = Math.sqrt(1 - e) * Math.sin(trueAnomalyRad / 2);
    const denominator = Math.sqrt(1 + e) * Math.cos(trueAnomalyRad / 2);
    return this.wrapRadians(2 * Math.atan2(numerator, denominator));
  },

  eccentricAnomalyFromMeanAnomaly(meanAnomalyRad, eccentricity = 0) {
    const e = Math.max(0, Math.min(0.999999, eccentricity || 0));
    const target = this.wrapRadians(meanAnomalyRad);
    if (e <= 1e-9) return target;

    let estimate = e < 0.8 ? target : Math.PI;
    for (let i = 0; i < 8; i++) {
      const f = estimate - (e * Math.sin(estimate)) - target;
      const fp = 1 - (e * Math.cos(estimate));
      estimate -= f / Math.max(fp, 1e-9);
    }
    return this.wrapRadians(estimate);
  },

  trueAnomalyFromEccentricAnomaly(eccentricAnomalyRad, eccentricity = 0) {
    const e = Math.max(0, Math.min(0.999999, eccentricity || 0));
    if (e <= 1e-9) return this.wrapRadians(eccentricAnomalyRad);
    const numerator = Math.sqrt(1 + e) * Math.sin(eccentricAnomalyRad / 2);
    const denominator = Math.sqrt(1 - e) * Math.cos(eccentricAnomalyRad / 2);
    return this.wrapRadians(2 * Math.atan2(numerator, denominator));
  },

  planetarySeasonState({
    seasonalDay,
    orbitalDays,
    axialTiltDeg,
    eccentricity = 0,
    perihelionLsDeg = 0,
    solarConstant = 1000,
  }) {
    const safeSeasonalDay = Math.max(1, Number(seasonalDay) || 1);
    const safeOrbitalDays = Math.max(1, Number(orbitalDays) || 1);
    const perihelionLsRad = (perihelionLsDeg || 0) * this.DEG;
    const vernalEquinoxTrueAnomaly = this.wrapRadians(-perihelionLsRad);
    const vernalEquinoxEccentricAnomaly = this.eccentricAnomalyFromTrueAnomaly(vernalEquinoxTrueAnomaly, eccentricity);
    const vernalEquinoxMeanAnomaly = this.wrapRadians(
      vernalEquinoxEccentricAnomaly - (eccentricity * Math.sin(vernalEquinoxEccentricAnomaly))
    );
    const elapsedMeanAnomaly = ((safeSeasonalDay - 1) / safeOrbitalDays) * this.TAU;
    const meanAnomaly = this.wrapRadians(vernalEquinoxMeanAnomaly + elapsedMeanAnomaly);
    const eccentricAnomaly = this.eccentricAnomalyFromMeanAnomaly(meanAnomaly, eccentricity);
    const trueAnomaly = this.trueAnomalyFromEccentricAnomaly(eccentricAnomaly, eccentricity);
    const solarLongitudeRad = this.wrapRadians(perihelionLsRad + trueAnomaly);
    const orbitalDistanceFactor = eccentricity > 1e-9
      ? ((1 - (eccentricity * eccentricity)) / (1 + (eccentricity * Math.cos(solarLongitudeRad - perihelionLsRad))))
      : 1;
    const declinationRad = Math.asin(
      Math.sin(axialTiltDeg * this.DEG) * Math.sin(solarLongitudeRad)
    );
    return {
      solarLongitudeDeg: this.wrapDegrees(solarLongitudeRad / this.DEG),
      declinationRad,
      orbitalDistanceFactor,
      solarFlux: solarConstant / Math.max(orbitalDistanceFactor * orbitalDistanceFactor, 1e-9),
    };
  },

  planetaryDailyProfile({
    latitude,
    seasonalDay,
    orbitalDays,
    axialTiltDeg,
    cycleHours,
    solarConstant = 1000,
    diffuseFraction = 0,
    eccentricity = 0,
    perihelionLsDeg = 0,
    bins = 24,
  }) {
    const latRad = latitude * this.DEG;
    const season = this.planetarySeasonState({
      seasonalDay,
      orbitalDays,
      axialTiltDeg,
      eccentricity,
      perihelionLsDeg,
      solarConstant,
    });
    const decl = season.declinationRad;
    const profile = [];
    const solarNoon = cycleHours / 2;
    let maxIrr = 0;

    for (let h = 0; h < bins; h++) {
      let totalIrr = 0;
      const subSteps = 4;
      for (let s = 0; s < subSteps; s++) {
        const t = (h + (s + 0.5) / subSteps) * (cycleHours / bins);
        const hourAngle = ((t - solarNoon) / cycleHours) * (2 * Math.PI);
        const elevation = this.solarElevation(latRad, decl, hourAngle);

        if (elevation > 0) {
          const beam = season.solarFlux * Math.sin(elevation);
          const diffuse = diffuseFraction * season.solarFlux * Math.max(0, Math.sin(elevation));
          totalIrr += Math.max(0, beam + diffuse);
        }
      }
      const avgIrr = totalIrr / subSteps;
      profile.push(avgIrr);
      if (avgIrr > maxIrr) maxIrr = avgIrr;
    }

    const normalized = this.normalizeProfile(profile, cycleHours);
    return {
      ...normalized,
      peakIrradiance: maxIrr,
      solarLongitudeDeg: season.solarLongitudeDeg,
      orbitalDistanceFactor: season.orbitalDistanceFactor,
      solarFlux: season.solarFlux,
    };
  },

  planetaryAnnualAverageProfile({
    latitude,
    orbitalDays,
    axialTiltDeg,
    cycleHours,
    solarConstant = 1000,
    diffuseFraction = 0,
    eccentricity = 0,
    perihelionLsDeg = 0,
    bins = 24,
  }) {
    const sampleDays = Array.from({ length: 12 }, (_, i) =>
      Math.max(1, Math.round(1 + (i * orbitalDays) / 12))
    );
    const avgProfile = new Array(bins).fill(0);

    sampleDays.forEach(day => {
      const result = this.planetaryDailyProfile({
        latitude,
        seasonalDay: day,
        orbitalDays,
        axialTiltDeg,
        cycleHours,
        solarConstant,
        diffuseFraction,
        eccentricity,
        perihelionLsDeg,
        bins,
      });
      for (let i = 0; i < bins; i++) avgProfile[i] += result.rawProfile[i];
    });

    const rawAvg = avgProfile.map(v => v / sampleDays.length);
    return this.normalizeProfile(rawAvg, cycleHours);
  },

  lunarPolarIlluminationProfile({
    cycleHours = 708.7,
    bins = 24,
    illuminatedFraction = 0.85,
    mountingKey = 'ew',
  }) {
    const visibility = this.lunarPolarVisibility(bins, illuminatedFraction);
    const rawProfile = visibility.map((visible, i) =>
      1361 * visible * this.lunarPolarMountCapture((i + 0.5) / bins, mountingKey));

    // Start the cycle at the end of the longest terrain outage.
    const darkSegments = this.getCyclicSegments(visibility, value => value <= 0.02);
    const longestDarkSegment = darkSegments.reduce((best, segment) =>
      (!best || segment.lengthBins > best.lengthBins ? segment : best), null);
    const alignedProfile = longestDarkSegment
      ? this.rotateProfile(rawProfile, longestDarkSegment.endExclusive)
      : rawProfile;

    return this.normalizeProfile(alignedProfile, cycleHours);
  },

  /* Terrain visibility (0-1) of the Sun from a high ridge near the lunar
     south pole over one lunation: mostly illuminated, with repeated shallow
     terrain dips and one deeper outage. */
  lunarPolarVisibility(bins = 24, illuminatedFraction = 0.85) {
    const targetDarkFraction = this.clamp(1 - illuminatedFraction, 0.05, 0.22);
    const majorShadowWidth = this.clamp(0.03 + (targetDarkFraction * 0.25), 0.04, 0.085);
    return Array.from({ length: bins }, (_, i) => {
      const phase = (i + 0.5) / bins;
      const broadIllumination = 0.80 + (0.08 * Math.cos((2 * Math.PI) * (phase - 0.18)));
      const microVariation = 0.02 * Math.cos((4 * Math.PI) * (phase - 0.05));
      const terrainLoss = (0.14 * this.gaussianWrappedPhase(phase, 0.19, 0.028))
        + (0.20 * this.gaussianWrappedPhase(phase, 0.43, 0.028))
        + (0.34 * this.gaussianWrappedPhase(phase, 0.61, 0.038))
        + (1.05 * this.gaussianWrappedPhase(phase, 0.83, majorShadowWidth));
      return this.clamp(broadIllumination + microVariation - terrainLoss, 0, 1);
    });
  },

  /* At the lunar PEL the Sun circles the horizon once per lunation at about
     +1 deg elevation (latitude ~89.5 S, 1.54 deg obliquity). */
  LUNAR_PEL_SUN_ELEVATION_DEG: 1,

  /* Share of the normal-incidence beam (no atmosphere, no diffuse) a
     mounting captures at a lunation phase (sun azimuth = 360 deg x phase).
     Sun-pointing "dual" panels (vertical, rotating about a vertical axis)
     capture ~100%; a horizontal-axis tracker within +/-60 deg ~55%; a fixed
     vertical panel facing one direction ~1/pi; 8 deg east-west racks ~6%.
     Panels are treated as unshaded (spaced masts, no row shading). */
  lunarPolarMountCapture(phase, mountingKey) {
    const elevation = this.LUNAR_PEL_SUN_ELEVATION_DEG * this.DEG;
    const azimuth = 2 * Math.PI * phase;
    const sunVec = {
      east: Math.cos(elevation) * Math.sin(azimuth),
      north: Math.cos(elevation) * Math.cos(azimuth),
      up: Math.sin(elevation),
    };
    return this.mountingPlaneIrradiance({
      sunVec,
      dni: 1,
      dhi: 0,
      ghi: 0,
      latitude: -89.5,
      mountingKey,
      fixedTiltDeg: 90,
      fixedAzimuthDeg: 0,
      groundCoverageRatio: 0,
    });
  },

  /* Lunar PEL yield multiple of a mounting vs. sun-pointing panels (the
     PEL base-yield reference), weighting each phase by terrain visibility. */
  lunarPolarMountingFactor(mountingKey, illuminatedFraction = 0.85, bins = 96) {
    const visibility = this.lunarPolarVisibility(bins, illuminatedFraction);
    let mount = 0;
    let reference = 0;
    visibility.forEach((visible, i) => {
      const phase = (i + 0.5) / bins;
      mount += visible * this.lunarPolarMountCapture(phase, mountingKey);
      reference += visible * this.lunarPolarMountCapture(phase, 'dual');
    });
    return reference > 0 ? mount / reference : 0;
  },

  /* Hourly plane-of-array irradiance (W/m2) over a 365-day Earth year:
     { hourly: Float64Array(8760), sum }. Cached per site and mounting;
     callers must not mutate the returned array. */
  annualHourlyPlaneOfArray(latitude, mountingKey, options = {}) {
    const key = [
      Number(latitude).toFixed(4),
      mountingKey,
      Number(options.beamTransmittance ?? 1).toFixed(4),
      options.fixedTiltDeg ?? '',
      Number(options.groundCoverageRatio ?? 0).toFixed(4),
    ].join('|');
    const cache = this._annualPoaCache || (this._annualPoaCache = new Map());
    if (cache.has(key)) return cache.get(key);

    const hourly = new Float64Array(365 * 24);
    let sum = 0;
    for (let day = 1; day <= 365; day++) {
      const raw = this.dailyProfile(latitude, day, mountingKey, options).rawProfile;
      for (let h = 0; h < 24; h++) {
        const value = Math.max(0, raw[h]);
        hourly[((day - 1) * 24) + h] = value;
        sum += value;
      }
    }
    const entry = { hourly, sum };
    if (cache.size >= 24) cache.delete(cache.keys().next().value);
    cache.set(key, entry);
    return entry;
  },

  /**
   * Day of year to date string.
   */
  dayToDateString(dayOfYear) {
    const date = new Date(2024, 0, dayOfYear); // 2024 is a leap year
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  },

  /**
   * Format hours as HH:MM.
   */
  hoursToTimeString(hours) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  },

  hoursToDisplayString(hours, cycleHours = 24) {
    if (!isFinite(hours)) return '—';
    if (cycleHours > 48) return `${formatOneDecimal(hours / 24)} Earth d`;
    return this.hoursToTimeString(hours);
  },

  /**
   * Get notable day name if applicable.
   */
  notableDay(dayOfYear) {
    if (dayOfYear >= 79 && dayOfYear <= 81) return ' (Spring Equinox)';
    if (dayOfYear >= 171 && dayOfYear <= 173) return ' (Summer Solstice)';
    if (dayOfYear >= 265 && dayOfYear <= 267) return ' (Fall Equinox)';
    if (dayOfYear >= 354 && dayOfYear <= 356) return ' (Winter Solstice)';
    return '';
  },
};
