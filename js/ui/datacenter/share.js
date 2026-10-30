/* Share links for the datacenter page: the non-default state in the URL hash (#s=...), using
   the shared ShareStateCodec. Preset-derived fields (DATACENTER_DERIVED_KEYS) always travel
   with a non-empty diff, so a link that changes the site keeps any price the user set. */

import {
  DATACENTER_DEFAULT_STATE,
  DATACENTER_DERIVED_KEYS,
  normalizeDatacenterState,
} from '../../state/datacenter-schema.js';
import { ShareStateCodec } from '../../state/share-codec.js';
import { setShareFeedback } from '../share-feedback.js';

const COMPARE_KEYS = Object.keys(DATACENTER_DEFAULT_STATE);
const URL_SYNC_DELAY_MS = 150;

/** Hash for a state ('' when it equals the defaults). */
export function serializeDatacenterHash(state, lzString) {
  return ShareStateCodec.serializeHashFromState(normalizeDatacenterState(state), DATACENTER_DEFAULT_STATE, {
    excludeKeys: [],
    alwaysIncludeKeys: DATACENTER_DERIVED_KEYS,
    lzString,
  });
}

/** { state, hasShareState, ignored, error } from a hash. */
export function parseDatacenterHash(hash, lzString) {
  try {
    const parsed = ShareStateCodec.parseHash(hash, { lzString });
    if (parsed.ignored) return { state: null, hasShareState: false, ignored: true, error: null };
    return { state: normalizeDatacenterState(parsed.hasState ? parsed.diff : {}), hasShareState: parsed.hasState, ignored: false, error: null };
  } catch (error) {
    return { state: normalizeDatacenterState({}), hasShareState: false, ignored: false, error };
  }
}

export const datacenterShareMethods = {
  setShareFeedback,

  initSharedState() {
    const result = parseDatacenterHash(window.location.hash, window.LZString);
    if (result.state) this.state = result.state;
    if (result.error) {
      console.warn('Unable to restore shared state from the URL hash.', result.error);
      this.pendingShareFeedback = { message: 'Shared link could not be loaded', tone: 'error' };
    }
  },

  bindShareControls() {
    document.getElementById('resetStateButton')?.addEventListener('click', () => this.resetState());
    window.addEventListener('hashchange', () => this.handleHashChange());
    if (this.pendingShareFeedback) {
      this.setShareFeedback(this.pendingShareFeedback.message, this.pendingShareFeedback.tone);
      this.pendingShareFeedback = null;
    }
  },

  handleHashChange() {
    const result = parseDatacenterHash(window.location.hash, window.LZString);
    if (result.error) this.setShareFeedback('Shared link could not be loaded', 'error');
    if (result.ignored || !result.state) return;
    if (ShareStateCodec.statesEqual(this.state, result.state, COMPARE_KEYS)) return;
    clearTimeout(this.shareUrlSyncTimer);
    this.state = result.state;
    this.syncStateToControls();
    this.recalculate();
  },

  scheduleShareStateUrlSync() {
    clearTimeout(this.shareUrlSyncTimer);
    this.shareUrlSyncTimer = window.setTimeout(() => {
      this.shareUrlSyncTimer = null;
      this.syncShareStateUrl();
    }, URL_SYNC_DELAY_MS);
  },

  syncShareStateUrl() {
    const nextHash = serializeDatacenterHash(this.state, window.LZString);
    const currentHash = window.location.hash || '';
    if (currentHash === nextHash) return nextHash;
    if (!nextHash && currentHash) {
      try {
        if (ShareStateCodec.parseHash(currentHash, { lzString: window.LZString }).ignored) return currentHash;
      } catch {
        // An invalid share hash is cleared below.
      }
    }
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
    return nextHash;
  },

  resetState() {
    clearTimeout(this.shareUrlSyncTimer);
    this.state = { ...DATACENTER_DEFAULT_STATE };
    this.syncStateToControls();
    this.recalculate();
    this.setShareFeedback('Reset to defaults', 'success');
  },
};
