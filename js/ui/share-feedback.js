/* Transient status text next to the header actions (reset, shared-link errors). A method:
   call it with the app as `this` (it keeps its timer on the app). */

const SHARE_FEEDBACK_DURATION_MS = 2200;

export function setShareFeedback(message = '', tone = '') {
  const status = document.getElementById('headerActionStatus');
  if (!status) return;

  clearTimeout(this.shareFeedbackTimer);
  this.shareFeedbackTimer = null;

  status.textContent = message;
  status.dataset.state = tone;

  if (!message) return;

  this.shareFeedbackTimer = window.setTimeout(() => {
    const currentStatus = document.getElementById('headerActionStatus');
    if (!currentStatus || currentStatus.textContent !== message) return;
    currentStatus.textContent = '';
    currentStatus.dataset.state = '';
    this.shareFeedbackTimer = null;
  }, SHARE_FEEDBACK_DURATION_MS);
}
