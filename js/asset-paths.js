(function initializeAssetPaths(globalScope) {
  const rawBuildId = '__APP_BUILD_ID__';
  const assetVersion = rawBuildId.startsWith('__') ? '' : rawBuildId;

  function resolve(path) {
    if (!assetVersion) return path;
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}v=${encodeURIComponent(assetVersion)}`;
  }

  globalScope.AssetPaths = {
    version: assetVersion,
    resolve,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
