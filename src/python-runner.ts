import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Candidates for Python 3.10+ (ppt-master requires 3.10+ for union type syntax) */
const PYTHON_CANDIDATES = ['python3.12', 'python3.11', 'python3.10', 'python3'];

function findPython(): string {
  const override = process.env.PPT_MASTER_PYTHON;
  if (override) return override;
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const result = spawnSync(candidate, ['--version'], { stdio: 'pipe', timeout: 5000 });
      const version = result.stdout?.toString().trim() ?? '';
      if (version.match(/Python 3\.(\d+)/)) {
        const minor = parseInt(version.match(/Python 3\.(\d+)/)![1]);
        if (minor >= 10) return candidate;
      }
    } catch {
      // not found, try next
    }
  }
  return 'python3'; // fallback, will error with clear message later
}

import { spawnSync } from 'child_process';

export class PythonScriptRunner {
  readonly pythonExecutable: string;
  readonly scriptsRoot: string;

  constructor(pythonExecutable?: string) {
    this.pythonExecutable = pythonExecutable ?? findPython();
    this.scriptsRoot = path.join(this.resolvePackageRoot(), 'scripts', 'ppt-master', 'scripts');
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
    const result = await this.runRaw(['--version'], { timeoutMs: 10000 });
    if (result.exitCode !== 0) {
      throw new Error(
        `python3 not found. Install Python 3.10+ or set PPT_MASTER_PYTHON to the python executable.\n${result.stderr}`
      );
    }
  }

  async checkPackages(packages: string[]): Promise<string[]> {
    const missing: string[] = [];
    for (const pkg of packages) {
      const result = await this.runRaw(['-c', `import ${pkg}`], { timeoutMs: 10000 });
      if (result.exitCode !== 0) {
        missing.push(pkg);
      }
    }
    return missing;
  }

  formatMissingPackages(missing: string[]): string {
    return (
      `Missing required Python packages: ${missing.join(', ')}. ` +
      `Install them with: npm run setup:python  (or  pip install -r scripts/ppt-master/requirements.txt)`
    );
  }

  async run(scriptRelative: string, args: string[], options?: RunOptions): Promise<RunResult> {
    const script = this.scriptPath(scriptRelative);
    if (!existsSync(script)) {
      throw new Error(`Python script not found: ${script}`);
    }
    return this.runRaw([script, ...args], options);
  }

  private runRaw(args: string[], options?: RunOptions): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const cwd = options?.cwd ?? process.cwd();
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8:replace',
        PYTHONPATH: this.scriptsRoot,
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

      const child = spawn(this.pythonExecutable, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf-8');
      child.stderr.setEncoding('utf-8');
      child.stdout.on('data', (chunk: string) => (stdout += chunk));
      child.stderr.on('data', (chunk: string) => (stderr += chunk));

      const timeoutMs = options?.timeoutMs ?? 120000;
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000).unref();
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        resolve({ exitCode: exitCode ?? -1, stdout, stderr });
      });
    });
  }
}
