/* Browser entry point for the Abundance Stack datacenter page: boots the DatacenterApp once the DOM is ready. */

import { DatacenterApp } from './ui/datacenter/app.js';

document.addEventListener('DOMContentLoaded', () => {
  window.app = new DatacenterApp();
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => window.app.recalculate?.(), 200);
  });
});
