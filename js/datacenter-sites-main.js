/* Browser entry point for the Abundance Stack sites page: optimizes the user's settings at every site once the DOM is ready. */

import { DatacenterSitesPage } from './ui/datacenter/sites-page.js';

document.addEventListener('DOMContentLoaded', () => {
  window.sitesPage = new DatacenterSitesPage();
});
