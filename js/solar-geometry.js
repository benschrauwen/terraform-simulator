/* ============================================
   Solar Geometry — Accurate Sun Position Model
   ============================================
   Computes solar irradiance profiles based on actual
   sun position (declination, hour angle, elevation)
   for any latitude and day of year.
*/

const SolarGeometry = {

  DEG: Math.PI / 180,

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

  planeOfArrayIrradiance(normal, tiltDeg, sunVec, dni, dhi) {
    const cosIncidence = Math.max(0, this.dot(sunVec, normal));
    const skyView = (1 + Math.cos(tiltDeg * this.DEG)) / 2;
    return (dni * cosIncidence) + (dhi * skyView);
  },

  mountingPlaneIrradiance({ sunVec, dni, dhi, latitude, mountingKey }) {
    if (sunVec.up <= 0) return 0;

    const fixedTilt = this.clamp(Math.abs(latitude) * 0.85, 10, 35);
    const equatorFacingAzimuth = latitude >= 0 ? 180 : 0;
    const eastWestTilt = 8;

    if (mountingKey === 'ew') {
      const east = this.planeOfArrayIrradiance(this.panelNormal(eastWestTilt, 90), eastWestTilt, sunVec, dni, dhi);
      const west = this.planeOfArrayIrradiance(this.panelNormal(eastWestTilt, 270), eastWestTilt, sunVec, dni, dhi);
      return 0.5 * (east + west);
    }

    if (mountingKey === 'single') {
      const normal = this.trackerNormal(sunVec);
      const tiltDeg = Math.acos(this.clamp(normal.up, -1, 1)) / this.DEG;
      return this.planeOfArrayIrradiance(normal, tiltDeg, sunVec, dni, dhi);
    }

    if (mountingKey === 'dual') {
      const normal = this.normalizeVec(sunVec);
      const tiltDeg = Math.acos(this.clamp(normal.up, -1, 1)) / this.DEG;
      return this.planeOfArrayIrradiance(normal, tiltDeg, sunVec, dni, dhi);
    }

    return this.planeOfArrayIrradiance(
      this.panelNormal(fixedTilt, equatorFacingAzimuth),
      fixedTilt,
      sunVec,
      dni,
      dhi
    );
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
   * Clear-sky direct normal irradiance (W/m²) based on air mass.
   * Simplified Hottel model.
   */
  clearSkyDNI(airMass) {
    if (!isFinite(airMass) || airMass <= 0) return 0;
    // Atmospheric transmittance model
    const tau = 0.7 * Math.pow(0.678, airMass);
    return 1361 * tau; // Solar constant * transmittance
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
   * Returns { profile: [24 values normalized 0-1], sunrise, sunset, dayLength, peakIrradiance }
   */
  dailyProfile(latitude, dayOfYear, mountingKey = 'fixed') {
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
          const am = this.airMass(elevDeg);
          const dni = this.clearSkyDNI(am) * etFactor;
          const dhi = 80 * Math.max(0, sunVec.up);
          totalIrr += this.mountingPlaneIrradiance({
            sunVec,
            dni,
            dhi,
            latitude,
            mountingKey,
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
  annualAverageProfile(latitude, mountingKey = 'fixed') {
    const sampleDays = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
    const avgProfile = new Array(24).fill(0);
    let totalInsolation = 0;
    let totalDayLength = 0;
    let totalSunrise = 0;
    let totalSunset = 0;

    for (const day of sampleDays) {
      const result = this.dailyProfile(latitude, day, mountingKey);
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
    const firstLit = rawProfile.findIndex(v => v > litThreshold);
    const lastLit = rawProfile.length - 1 - [...rawProfile].reverse().findIndex(v => v > litThreshold);
    const stepHours = cycleHours / rawProfile.length;
    const sunrise = firstLit >= 0 ? firstLit * stepHours : 0;
    const sunset = firstLit >= 0 ? (lastLit + 1) * stepHours : 0;
    const dayLengthHours = firstLit >= 0 ? (lastLit - firstLit + 1) * stepHours : 0;

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

  planetaryDailyProfile({
    latitude,
    seasonalDay,
    orbitalDays,
    axialTiltDeg,
    cycleHours,
    solarConstant = 1000,
    diffuseFraction = 0,
    bins = 24,
  }) {
    const latRad = latitude * this.DEG;
    const decl = this.planetaryDeclination(seasonalDay, orbitalDays, axialTiltDeg);
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
          const beam = solarConstant * Math.sin(elevation);
          const diffuse = diffuseFraction * solarConstant;
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
    };
  },

  planetaryAnnualAverageProfile({
    latitude,
    orbitalDays,
    axialTiltDeg,
    cycleHours,
    solarConstant = 1000,
    diffuseFraction = 0,
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
        bins,
      });
      for (let i = 0; i < bins; i++) avgProfile[i] += result.rawProfile[i];
    });

    const rawAvg = avgProfile.map(v => v / sampleDays.length);
    return this.normalizeProfile(rawAvg, cycleHours);
  },

  lunarPolarIlluminationProfile({ cycleHours = 708.7, bins = 24, illuminatedFraction = 0.85 }) {
    const horizonProxy = 1 - (2 * illuminatedFraction);
    const rawProfile = Array.from({ length: bins }, (_, i) => {
      const phase = i / bins;
      const elevationProxy = Math.cos((2 * Math.PI * (phase - 0.08)));
      if (elevationProxy <= horizonProxy) return 0;
      const normalizedLight = (elevationProxy - horizonProxy) / (1 - horizonProxy);
      return 220 + (780 * normalizedLight);
    });

    return this.normalizeProfile(rawProfile, cycleHours);
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
    if (cycleHours > 48) return `${FormatNumbers.fixed(hours / 24, 1)} Earth d`;
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
