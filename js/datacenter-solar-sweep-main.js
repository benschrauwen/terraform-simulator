/* Browser entry point for the hidden solar price sweep page (datacenter-solar-sweep.html). */

import { SolarSweepPage } from './ui/datacenter/solar-sweep-page.js';

document.addEventListener('DOMContentLoaded', () => {
  window.solarSweepPage = new SolarSweepPage();
});
