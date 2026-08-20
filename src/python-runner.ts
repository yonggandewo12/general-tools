/**
 * Spawn Python child processes to run scripts under scripts/ppt-master/ and
 * scripts/excel/. Looks up Python in this priority order:
 *
 *   1. `PPT_MASTER_PYTHON` env override
 *   2. Embedded Python bundled by the matching @general-tools/python-runtime-*
 *      platform sub-package (downloaded with the npm package)
 *   3. System Python 3.10+ on PATH
 *
 * Throws `MissingPythonError` (with per-OS install hint) when none of the
 * three sources resolves to a working interpreter.
 */
import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** 若提供，将通过子进程 stdin 写入该字符串（避免命令行参数长度限制） */
  stdin?: string;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Thrown when no working Python interpreter can be located. */
export class MissingPythonError extends Error {
  readonly code = 'MISSING_PYTHON';
  constructor(
    public installHint: string,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'MissingPythonError';
  }
}

const PACKAGE_SCOPE = '@general-tools';
const RUNTIME_PKG_PREFIX = `${PACKAGE_SCOPE}/python-runtime-`;
const PYTHON_MINOR = '3.12';

/**
 * Map the current process's platform/arch to the matching npm sub-package
 * suffix. Returns `null` when the host is not one of the 5 supported triples.
 */
export function platformSuffix(): string | null {
  const { platform: p, arch } = process;
  if (p === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (p === 'linux' && arch === 'x64') return 'linux-x64-gnu';
  if (p === 'linux' && arch === 'arm64') return 'linux-arm64-gnu';
  if (p === 'win32' && arch === 'x64') return 'win32-x64-msvc';
  return null;
}

export const SUPPORTED_PLATFORM_SUFFIXES = [
  'darwin-arm64',
  'linux-x64-gnu',
  'linux-arm64-gnu',
  'win32-x64-msvc',
] as const;

/**
 * Resolve the path to the embedded python binary shipped in the matching
 * `@general-tools/python-runtime-<suffix>/` npm sub-package. Returns `null`
 * if the sub-package is not installed (e.g., user is on an unsupported host
 * or removed optionalDependencies).
 */
export function findEmbeddedPython(): { pythonBin: string; scriptsRoot: string; pkgRoot: string } | null {
  const suffix = platformSuffix();
  if (!suffix) return null;
  const pkgName = `${RUNTIME_PKG_PREFIX}${suffix}`;

  // Walk up from this file's directory looking for node_modules/<pkg>.
  // Different depths cover both ESM-compiled dist/ and source-tree usage.
  const currentFile = fileURLToPath(import.meta.url);
  let dir = path.dirname(currentFile);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'node_modules', pkgName);
    if (existsSync(path.join(candidate, 'package.json'))) {
      const isWin = process.platform === 'win32';
      const pythonBin = isWin
        ? path.join(candidate, 'python', 'python.exe')
        : path.join(candidate, 'python', 'bin', 'python3.12');
      const scriptsRoot = path.join(candidate, 'scripts', 'ppt-master', 'scripts');
      if (existsSync(pythonBin) && existsSync(scriptsRoot)) {
        return { pythonBin, scriptsRoot, pkgRoot: candidate };
      }
      return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Per-OS install hint surfaced via MissingPythonError.installHint. */
function installHintForOS(): string {
  const p = process.platform;
  if (p === 'darwin') {
    const arch = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    return (
      `On macOS, the embedded Python may be blocked by Gatekeeper quarantine. Run:\n` +
      `  PY="$(node -e "console.log(require.resolve('${RUNTIME_PKG_PREFIX}${arch}/package.json')+'../python/bin/python3.12')")"\n` +
      `  xattr -dr com.apple.quarantine "$PY" && "$PY" --version\n` +
      `If still failing, install Python 3.10+ via brew (https://brew.sh) and set PPT_MASTER_PYTHON.`
    );
  }
  if (p === 'win32') {
    return (
      `On Windows, the embedded Python may be blocked by SmartScreen. Unblock the file:\n` +
      `  PowerShell: Unblock-File "$env:USERPROFILE\\node_modules\\${RUNTIME_PKG_PREFIX}win32-x64-msvc\\python\\python.exe"\n` +
      `  Or right-click python.exe -> Properties -> Unblock.\n` +
      `If still failing, install Python 3.10+ from https://python.org and set PPT_MASTER_PYTHON.`
    );
  }
  if (p === 'linux') {
    return (
      `On Linux, the embedded Python requires glibc >= 2.31 (verify with: ldd --version).\n` +
      `If still failing, install Python 3.10+ via your package manager and set PPT_MASTER_PYTHON.`
    );
  }
  return `Install Python 3.10+ and set PPT_MASTER_PYTHON, or install the matching ${RUNTIME_PKG_PREFIX}<platform> package.`;
}

/** Probe a python interpreter and return its version string, or null. */
function probePython(pythonBin: string): string | null {
  try {
    const result = spawnSync(pythonBin, ['--version'], { stdio: 'pipe', timeout: 5000 });
    if (result.status !== 0) return null;
    const version = (result.stdout?.toString() ?? result.stderr?.toString() ?? '').trim();
    const match = version.match(/Python 3\.(\d+)/);
    if (!match) return null;
    const minor = parseInt(match[1]);
    return minor >= 10 ? version : null;
  } catch {
    return null;
  }
}

/** Candidates for system Python 3.10+. */
const SYSTEM_PYTHON_CANDIDATES = ['python3.12', 'python3.11', 'python3.10', 'python3'];

/**
 * Resolve which Python to use. Throws `MissingPythonError` if none of the
 * three priority sources works.
 */
export function findPython(): string {
  // 1. Env override
  const override = process.env.PPT_MASTER_PYTHON;
  if (override) {
    if (probePython(override)) return override;
    throw new MissingPythonError(
      installHintForOS(),
      `PPT_MASTER_PYTHON=${override} does not resolve to a working Python 3.10+ interpreter.`,
    );
  }

  // 2. Embedded Python from the per-platform sub-package
  const embedded = findEmbeddedPython();
  if (embedded) {
    const version = probePython(embedded.pythonBin);
    if (version) {
      // Stash the resolved embedded paths so the runner can reuse them
      // without re-walking node_modules.
      EMBEDDED_CACHE = embedded;
      return embedded.pythonBin;
    }
    throw new MissingPythonError(
      installHintForOS(),
      `Embedded Python at ${embedded.pythonBin} is not executable.`,
    );
  }

  // 3. System Python on PATH
  for (const candidate of SYSTEM_PYTHON_CANDIDATES) {
    if (probePython(candidate)) return candidate;
  }

  // 4. Nothing works
  const suffix = platformSuffix();
  const pkgName = suffix ? `${RUNTIME_PKG_PREFIX}${suffix}` : null;
  const subpkgHint = pkgName
    ? `If you installed general-tools-mcp-server via npm, ensure the optional dependency @general-tools/python-runtime-${suffix} is present (npm ls @general-tools/python-runtime-*).`
    : `Your host platform (${process.platform}-${process.arch}) is not one of: ${SUPPORTED_PLATFORM_SUFFIXES.join(', ')}.`;
  throw new MissingPythonError(
    `${installHintForOS()}\n${subpkgHint}`,
    `No working Python 3.10+ interpreter found for general-tools.`,
  );
}

/** Cache the last-resolved embedded python paths so the runner reuses them. */
let EMBEDDED_CACHE: { pythonBin: string; scriptsRoot: string; pkgRoot: string } | null = null;

export class PythonScriptRunner {
  readonly pythonExecutable: string;
  readonly scriptsRoot: string;
  readonly embeddedPkgRoot: string | undefined;

  constructor(pythonExecutable?: string, scriptsRootOverride?: string) {
    this.pythonExecutable = pythonExecutable ?? findPython();
    // If the embedded python was resolved, prefer its bundled scripts/ over
    // whatever lives next to the consumer's general-tools-mcp-server install.
    // (The two trees are identical, but the embedded one ships with the
    // runtime sub-package and avoids relying on the main package's files
    // whitelist.)
    const embedded = EMBEDDED_CACHE;
    if (embedded && pythonExecutable === undefined) {
      this.scriptsRoot = scriptsRootOverride ?? embedded.scriptsRoot;
      this.embeddedPkgRoot = embedded.pkgRoot;
    } else {
      this.scriptsRoot =
        scriptsRootOverride ?? path.join(this.resolvePackageRoot(), 'scripts', 'ppt-master', 'scripts');
      this.embeddedPkgRoot = undefined;
    }
  }

  private resolvePackageRoot(): string {
    const currentFile = fileURLToPath(import.meta.url);
    let dir = path.dirname(currentFile);
    while (dir !== path.dirname(dir)) {
      if (existsSync(path.join(dir, 'package.json'))) {
        return dir;
      }
      dir = path.dirname(dir);
    }
    throw new Error('Cannot locate package root (no package.json ancestor)');
  }

  scriptPath(relative: string): string {
    return path.join(this.scriptsRoot, relative);
  }

  async checkPython(): Promise<void> {
    try {
      const result = await this.runRaw(['--version'], { timeoutMs: 10000 });
      if (result.exitCode !== 0) {
        throw new MissingPythonError(
          installHintForOS(),
          `python interpreter at ${this.pythonExecutable} returned non-zero (${result.exitCode}).\n${result.stderr}`,
        );
      }
    } catch (err) {
      if (err instanceof MissingPythonError) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new MissingPythonError(
          installHintForOS(),
          `python interpreter not found at ${this.pythonExecutable}.`,
          err,
        );
      }
      throw err;
    }
  }

  async checkPackages(packages: string[]): Promise<string[]> {
    const missing: string[] = [];
    for (const pkg of packages) {
      try {
        const result = await this.runRaw(['-c', `import ${pkg}`], { timeoutMs: 10000 });
        if (result.exitCode !== 0) missing.push(pkg);
      } catch {
        missing.push(pkg);
      }
    }
    return missing;
  }

  formatMissingPackages(missing: string[]): string {
    const hint =
      this.embeddedPkgRoot !== undefined
        ? `Reinstall the runtime sub-package: rm -rf "${this.embeddedPkgRoot}" && npm install -f`
        : `pip install -r scripts/ppt-master/requirements.txt (or set PPT_MASTER_PYTHON to a Python with these packages)`;
    return `Missing required Python packages: ${missing.join(', ')}. ${hint}`;
  }

  async run(scriptRelative: string, args: string[], options?: RunOptions): Promise<RunResult> {
    const script = this.scriptPath(scriptRelative);
    if (!existsSync(script)) {
      throw new Error(`Python script not found: ${script}`);
    }
    return this.runRaw([script, ...args], options);
  }

  /** 运行任意绝对路径的 Python 脚本（不局限于 scriptsRoot）。 */
  async runPath(absoluteScript: string, args: string[], options?: RunOptions): Promise<RunResult> {
    if (!existsSync(absoluteScript)) {
      throw new Error(`Python script not found: ${absoluteScript}`);
    }
    return this.runRaw([absoluteScript, ...args], options);
  }

  private runRaw(args: string[], options?: RunOptions): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const cwd = options?.cwd ?? process.cwd();
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8:replace',
        PYTHONPATH: this.scriptsRoot,
        // Tell the embedded relocatable Python where its prefix lives so it
        // doesn't fall back to a system PYTHONHOME when both happen to exist.
        PYTHONHOME: this.embeddedPkgRoot ? path.join(this.embeddedPkgRoot, 'python') : '',
        // Help the embedded Python find its bundled pip wheels.
        ...(this.embeddedPkgRoot
          ? { PYTHONPATH: `${path.join(this.embeddedPkgRoot, 'python', 'lib', `python${PYTHON_MINOR}`, 'site-packages')}${path.delimiter}${this.scriptsRoot}` }
          : {}),
      };
      if (options?.env) {
        for (const [key, value] of Object.entries(options.env)) {
          if (value !== undefined) {
            env[key] = value;
          } else {
            delete env[key];
          }
        }
      }

      const hasStdin = options?.stdin !== undefined;
      const child = spawn(this.pythonExecutable, args, {
        cwd,
        env,
        stdio: [hasStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      if (child.stdout) {
        child.stdout.setEncoding('utf-8');
        child.stdout.on('data', (chunk: string) => (stdout += chunk));
      }
      if (child.stderr) {
        child.stderr.setEncoding('utf-8');
        child.stderr.on('data', (chunk: string) => (stderr += chunk));
      }

      if (hasStdin && child.stdin) {
        child.stdin.end(options!.stdin!);
      }

      const timeoutMs = options?.timeoutMs ?? 120000;
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000).unref();
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timeout);
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') {
          reject(
            new MissingPythonError(
              installHintForOS(),
              `python interpreter not found at ${this.pythonExecutable}.`,
              err,
            ),
          );
          return;
        }
        reject(err);
      });

      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        resolve({ exitCode: exitCode ?? -1, stdout, stderr });
      });
    });
  }
}