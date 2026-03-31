/* ============================================
   Display number formatting (en-US thousands)
   ============================================ */

const FormatNumbers = {
  /**
   * @param {number} n
   * @param {number} decimals
   */
  fixed(n, decimals) {
    if (n === undefined || n === null || !Number.isFinite(Number(n))) return '—';
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  },

  formatMoney(val) {
    if (val === undefined || val === null || Number.isNaN(val)) return '$0';
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    if (abs >= 1e9) {
      return `${sign}$${(abs / 1e9).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B`;
    }
    if (abs >= 1e6) {
      return `${sign}$${(abs / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
    }
    if (abs >= 1e3) {
      return `${sign}$${(abs / 1e3).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}K`;
    }
    return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  },
};
