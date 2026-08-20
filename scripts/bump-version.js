#!/usr/bin/env node
/**
 * Bump the package version AND keep the 5 general-tools-mcp-server-runtime-*
 * optionalDependencies in sync, so consumers of `npm install general-tools-mcp-server`
 * always pull matching-platform sub-packages.
 *
 * Usage:
 *   node scripts/bump-version.js 1.2.3     # absolute version
 *   node scripts/bump-version.js patch     # bump patch component
 *   node scripts/bump-version.js minor     # bump minor component
 *   node scripts/bump-version.js major     # bump major component
 *
 * The script edits package.json in place AND refreshes package-lock.json
 * to keep them in sync. npm ci in the publish workflow requires exact
 * lockfile sync; without this, the workflow fails with EUSAGE.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = resolve(__dirname, '..', 'package.json');
const LOCK_PATH = resolve(__dirname, '..', 'package-lock.json');

const RUNTIME_PKG_PREFIX = 'general-tools-mcp-server-runtime-';
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/;

function parseVersion(v) {
  const m = SEMVER_RE.exec(v);
  if (!m) throw new Error(`Invalid semver: ${v}`);
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

function formatVersion([maj, min, pat]) {
  return `${maj}.${min}.${pat}`;
}

function bumpComponent(current, component) {
  const [maj, min, pat] = parseVersion(current);
  switch (component) {
    case 'major': return formatVersion([maj + 1, 0, 0]);
    case 'minor': return formatVersion([maj, min + 1, 0]);
    case 'patch': return formatVersion([maj, min, pat + 1]);
    default: throw new Error(`Unknown component: ${component}; expected major/minor/patch or absolute version.`);
  }
}

/** Numeric compare: -1 if a<b, 0 if equal, 1 if a>b. */
function compareVersions(a, b) {
  const [aMaj, aMin, aPat] = parseVersion(a);
  const [bMaj, bMin, bPat] = parseVersion(b);
  if (aMaj !== bMaj) return aMaj > bMaj ? 1 : -1;
  if (aMin !== bMin) return aMin > bMin ? 1 : -1;
  if (aPat !== bPat) return aPat > bPat ? 1 : -1;
  return 0;
}

function listRuntimeDeps(optionalDependencies) {
  return Object.entries(optionalDependencies ?? {})
    .filter(([name]) => name.startsWith(RUNTIME_PKG_PREFIX))
    .map(([name]) => name);
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/bump-version.js <version | patch | minor | major>');
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
  const oldVersion = pkg.version;
  const newVersion = SEMVER_RE.test(arg) ? arg : bumpComponent(oldVersion, arg);

  // Reject downgrades and no-ops. Compare numerically, not lexically,
  // so e.g. "1.10.0" sorts correctly against "1.9.0".
  const cmp = compareVersions(newVersion, oldVersion);
  if (cmp <= 0) {
    const reason =
      cmp === 0
        ? 'no change'
        : `downgrade (${oldVersion} -> ${newVersion})`;
    console.error(`Refusing to bump: ${reason}.`);
    process.exit(1);
  }

  pkg.version = newVersion;
  const runtimeDeps = listRuntimeDeps(pkg.optionalDependencies);
  for (const name of runtimeDeps) {
    pkg.optionalDependencies[name] = newVersion;
  }

  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');

  console.log(`Bumped ${oldVersion} -> ${newVersion}`);
  console.log(`Updated ${runtimeDeps.length} optionalDependencies:`);
  for (const name of runtimeDeps) {
    console.log(`  ${name}: ${oldVersion} -> ${newVersion}`);
  }

  // Refresh package-lock.json so npm ci in the publish workflow doesn't
  // reject the lockfile as out-of-sync. We use --package-lock-only to
  // avoid reinstalling the world just for a version bump.
  if (existsSync(LOCK_PATH)) {
    console.log('');
    console.log('Refreshing package-lock.json...');
    try {
      execFileSync('npm', ['install', '--package-lock-only', '--allow-remote=all'], {
        cwd: resolve(__dirname, '..'),
        stdio: 'inherit',
      });
    } catch (err) {
      console.error('Failed to refresh lock file:');
      console.error(err.message);
      console.error('Run `npm install --package-lock-only --allow-remote=all` manually.');
      process.exit(1);
    }
  }

  console.log('');
  console.log('Next steps:');
  console.log('  git diff package.json package-lock.json  # review the change');
  console.log('  git add package.json package-lock.json && git commit -m "chore: bump v' + newVersion + '"');
  console.log('  git push  # triggers CI publish workflow');
}

main();