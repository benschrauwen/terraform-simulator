import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUILD_ID = getBuildId();
const BUILD_TOKEN = '__APP_BUILD_ID__';

const EXCLUDED_PATH_PREFIXES = ['.git', 'dist', 'node_modules', 'scripts', 'tests'];
const EXCLUDED_ROOT_FILES = new Set(['.gitignore', 'package.json', 'package-lock.json', 'vercel.json']);
const TEXT_FILE_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.svg', '.txt']);

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(DIST, { recursive: true });
await copyProjectTree(ROOT, DIST, '');
await rewriteDistFiles(DIST);

console.log(`Built dist/ with asset version ${BUILD_ID}`);

function getBuildId() {
  const envBuildId = (
    process.env.BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    ''
  ).trim();

  if (envBuildId) return envBuildId.slice(0, 12);

  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  }
}

function shouldSkip(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (!normalized) return false;

  const pathParts = normalized.split('/');
  if (EXCLUDED_PATH_PREFIXES.includes(pathParts[0])) return true;
  if (pathParts.length === 1 && EXCLUDED_ROOT_FILES.has(pathParts[0])) return true;

  return false;
}

async function copyProjectTree(sourceDir, targetDir, relativePath) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
    if (shouldSkip(entryRelativePath)) continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: true });
      await copyProjectTree(sourcePath, targetPath, entryRelativePath);
      continue;
    }

    await fs.copyFile(sourcePath, targetPath);
  }
}

async function rewriteDistFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await rewriteDistFiles(entryPath);
      continue;
    }

    if (!TEXT_FILE_EXTENSIONS.has(path.extname(entry.name))) continue;

    const original = await fs.readFile(entryPath, 'utf8');
    let updated = original.replaceAll(BUILD_TOKEN, BUILD_ID);

    if (path.extname(entry.name) === '.html') {
      updated = rewriteLocalAssetUrls(updated, BUILD_ID);
    }

    if (updated !== original) {
      await fs.writeFile(entryPath, updated);
    }
  }
}

function rewriteLocalAssetUrls(html, buildId) {
  return html.replace(/\b(src|href)=(["'])([^"']+)\2/g, (match, attribute, quote, url) => {
    if (!shouldVersionAssetUrl(url)) return match;
    const separator = url.includes('?') ? '&' : '?';
    return `${attribute}=${quote}${url}${separator}v=${buildId}${quote}`;
  });
}

function shouldVersionAssetUrl(url) {
  if (/^(?:[a-z]+:)?\/\//i.test(url)) return false;
  if (/^(?:data:|mailto:|tel:|#)/i.test(url)) return false;
  return /\.(?:css|js)(?:$|[?#])/i.test(url);
}
