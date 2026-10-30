/*
 * Placeholder DatacenterApp so datacenter.html boots end to end; the datacenter UI
 * replaces it. It only writes a status line into the layout view.
 */

export class DatacenterApp {
  constructor(root = document) {
    const target = root.getElementById('layoutView');
    if (!target) return;
    const message = root.createElement('p');
    message.className = 'field-note';
    message.textContent = 'Datacenter simulator loading…';
    target.replaceChildren(message);
  }
}
