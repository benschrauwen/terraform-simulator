/* Shareable URL state helpers attached to App */

const SHARE_STATE_COMPARE_KEYS = Object.keys(DEFAULT_STATE);
const SHARE_FEEDBACK_DURATION_MS = 2200;
const SHARE_URL_SYNC_DELAY_MS = 150;

const AppShareStateMethods = {
  initSharedState() {
    this.shareFeedbackTimer = null;
    this.shareUrlSyncTimer = null;
    this.pendingShareFeedback = null;

    const result = AppShareStateMethods.readSharedStateFromHash.call(this, window.location.hash);
    if (result.state) {
      this.state = result.state;
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
    }, SHARE_URL_SYNC_DELAY_MS);
  },

  syncShareStateUrl() {
    const nextHash = ShareStateCodec.serializeHashFromState(this.state, DEFAULT_STATE, {
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
