/* Shareable URL state helpers attached to App */

const SHARE_STATE_COMPARE_KEYS = Object.keys(DEFAULT_STATE);
const SHARE_FEEDBACK_DURATION_MS = 2200;
const SHARE_URL_SYNC_DELAY_MS = 150;

function mergeStateForShareExport(state, defaults) {
  const merged = { ...defaults };
  if (!state || typeof state !== 'object') return merged;
  Object.keys(state).forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(state, key)) return;
    const value = state[key];
    if (value === undefined) return;
    merged[key] = value;
  });
  return merged;
}

const AppShareStateMethods = {
  initSharedState() {
    this.shareFeedbackTimer = null;
    this.shareUrlSyncTimer = null;
    this.pendingShareFeedback = null;
    this.deferSavedSitePersistUntilNextSync = false;
    this._hashHydratedState = null;

    const result = AppShareStateMethods.readSharedStateFromHash.call(this, window.location.hash);
    if (result.state) {
      this.state = result.state;
    }

    if (result.hasShareState) {
      this.deferSavedSitePersistUntilNextSync = true;
      this._hashHydratedState = { ...this.state };
    }

    if (result.error) {
      this.pendingShareFeedback = {
        message: 'Shared link could not be loaded',
        tone: 'error',
      };
    }
  },

  bindShareControls() {
    const resetButton = document.getElementById('resetStateButton');
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        AppShareStateMethods.resetState.call(this);
      });
    }

    window.addEventListener('hashchange', () => {
      AppShareStateMethods.handleHashChange.call(this);
    });

    if (this.pendingShareFeedback) {
      AppShareStateMethods.setShareFeedback.call(
        this,
        this.pendingShareFeedback.message,
        this.pendingShareFeedback.tone
      );
      this.pendingShareFeedback = null;
    }
  },

  readSharedStateFromHash(hash = window.location.hash) {
    try {
      const parsed = ShareStateCodec.parseHash(hash, {
        lzString: window.LZString,
      });

      if (parsed.ignored) {
        return {
          error: null,
          hasShareState: false,
          ignored: true,
          state: null,
        };
      }

      if (!parsed.hasState) {
        return {
          error: null,
          hasShareState: false,
          ignored: false,
          state: { ...DEFAULT_STATE },
        };
      }

      return {
        error: null,
        hasShareState: true,
        ignored: false,
        state: Calc.normalizeState(parsed.diff),
      };
    } catch (error) {
      console.warn('Unable to restore shared state from the URL hash.', error);
      return {
        error,
        hasShareState: false,
        ignored: false,
        state: { ...DEFAULT_STATE },
      };
    }
  },

  handleHashChange() {
    const result = AppShareStateMethods.readSharedStateFromHash.call(this, window.location.hash);

    if (result.error) {
      AppShareStateMethods.setShareFeedback.call(this, 'Shared link could not be loaded', 'error');
    }

    if (result.ignored || !result.state) return;

    if (ShareStateCodec.statesEqual(this.state, result.state, SHARE_STATE_COMPARE_KEYS)) {
      if (result.error) {
        AppShareStateMethods.syncShareStateUrl.call(this);
      }
      return;
    }

    clearTimeout(this.shareUrlSyncTimer);
    this.shareUrlSyncTimer = null;

    this.state = result.state;
    if (result.hasShareState) {
      this.deferSavedSitePersistUntilNextSync = true;
      this._hashHydratedState = { ...this.state };
    } else {
      this.deferSavedSitePersistUntilNextSync = false;
      this._hashHydratedState = null;
    }
    this.syncStateToControls();
    this.syncDynamicVisibility();
    this.syncDerivedFeedControls();
    this.recalculate();
  },

  scheduleShareStateUrlSync() {
    clearTimeout(this.shareUrlSyncTimer);
    this.shareUrlSyncTimer = window.setTimeout(() => {
      this.shareUrlSyncTimer = null;
      AppShareStateMethods.syncShareStateUrl.call(this);
      if (this.skipInitialSavedSitePersist) {
        this.skipInitialSavedSitePersist = false;
      } else {
        AppShareStateMethods.persistSavedSiteAppStateIfNeeded.call(this);
      }
    }, SHARE_URL_SYNC_DELAY_MS);
  },

  persistSavedSiteAppStateIfNeeded() {
    if (typeof SavedSitePresets === 'undefined' || !SavedSitePresets.saveAppStateForSite) return;
    if (
      this.deferSavedSitePersistUntilNextSync &&
      this._hashHydratedState &&
      ShareStateCodec.statesEqual(this.state, this._hashHydratedState, SHARE_STATE_COMPARE_KEYS)
    ) {
      return;
    }
    if (this.deferSavedSitePersistUntilNextSync && this._hashHydratedState) {
      this.deferSavedSitePersistUntilNextSync = false;
    }
    const sel = document.getElementById('locationPreset');
    const savedId = SavedSitePresets.parseOptionValue(sel?.value || '');
    if (!savedId || !SavedSitePresets.getById(savedId)) return;
    const snapshot = mergeStateForShareExport(this.state, DEFAULT_STATE);
    SavedSitePresets.saveAppStateForSite(savedId, snapshot);
  },

  syncShareStateUrl() {
    const exportState = mergeStateForShareExport(this.state, DEFAULT_STATE);
    const nextHash = ShareStateCodec.serializeHashFromState(exportState, DEFAULT_STATE, {
      excludeKeys: ShareStateCodec.EXCLUDED_STATE_KEYS,
      lzString: window.LZString,
    });
    const currentHash = window.location.hash || '';

    if (!nextHash && currentHash) {
      try {
        const parsedCurrentHash = ShareStateCodec.parseHash(currentHash, {
          lzString: window.LZString,
        });
        if (parsedCurrentHash.ignored) {
          return currentHash;
        }
      } catch {
        // Invalid share hashes should still be cleared when the state falls back to defaults.
      }
    }

    if (currentHash === nextHash) return nextHash;

    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
    window.history.replaceState(null, '', nextUrl);
    return nextHash;
  },

  resetState() {
    if (this.pendingRecalculateFrame !== null) {
      window.cancelAnimationFrame(this.pendingRecalculateFrame);
      this.pendingRecalculateFrame = null;
      this.pendingRecalculateOptions = null;
    }

    clearTimeout(this.shareUrlSyncTimer);
    this.shareUrlSyncTimer = null;

    this.state = { ...DEFAULT_STATE };
    this.deferSavedSitePersistUntilNextSync = false;
    this._hashHydratedState = null;
    this.skipInitialSavedSitePersist = false;
    this.syncStateToControls();
    this.syncDynamicVisibility();
    this.syncDerivedFeedControls();
    this.recalculate();
    AppShareStateMethods.setShareFeedback.call(this, 'Reset to defaults', 'success');
  },

  setShareFeedback(message = '', tone = '') {
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
  },
};

window.AppShareStateMethods = AppShareStateMethods;
