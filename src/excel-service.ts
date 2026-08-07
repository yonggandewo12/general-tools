import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PythonScriptRunner } from './python-runner.js';

export interface ExcelCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
  errorType?: string;
  details?: {
    processingTime: number;
  };
}

/**
 * Excel 操作服务：通过子进程调用 scripts/excel/run.py，复用项目既有 Python 集成模式。
 * 与 PptMasterService 架构对称，部署/检测/超时处理一致。
 */
export class ExcelService {
  private runner: PythonScriptRunner;
  private runScript: string;
  private depChecked = false;

  constructor() {
    const pkgRoot = this.resolvePackageRoot();
    this.runScript = path.join(pkgRoot, 'scripts', 'excel', 'run.py');
    const scriptsRoot = path.join(pkgRoot, 'scripts', 'excel');
    this.runner = new PythonScriptRunner(undefined, scriptsRoot);
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

  /** 检查 python + openpyxl 可用，缓存结果。失败抛出含安装指引的错误。 */
  async checkDeps(): Promise<void> {
    if (this.depChecked) return;
    if (!existsSync(this.runScript)) {
      throw new Error(`Excel entry script not found: ${this.runScript}`);
    }
    const result = await this.runner.runPath(this.runScript, ['--check'], { timeoutMs: 15000 });
    if (result.exitCode !== 0) {
      throw new Error(
        `Excel dependencies not ready (exit ${result.exitCode}). ` +
          `Install with: pip install -r scripts/excel/requirements.txt\n${result.stderr}`
      );
    }
    this.depChecked = true;
  }

  /**
   * 调用一个 Excel action。
   * @param action run.py 中注册的 action 名
   * @param params 参数对象
   * @param timeoutMs 超时，默认 60s
   */
  async call(action: string, params: Record<string, unknown>, timeoutMs = 60000): Promise<ExcelCallResult> {
    const start = Date.now();
    await this.checkDeps();
    const paramsJson = JSON.stringify(params);
    // 走 stdin 传输 params，规避命令行参数长度限制（Windows ~32KB）
    const result = await this.runner.runPath(this.runScript, ['--action', action], {
      timeoutMs,
      stdin: paramsJson,
    });
    const processingTime = Date.now() - start;

    const stdout = result.stdout.trim();
    if (!stdout) {
      return {
        success: false,
        error: `Excel action ${action} produced no output. stderr: ${result.stderr.slice(0, 500)}`,
        code: 'NO_OUTPUT',
        details: { processingTime },
      };
    }

    try {
      const parsed = JSON.parse(stdout) as ExcelCallResult;
      return { ...parsed, details: { processingTime } };
    } catch {
      return {
        success: false,
        error: `Failed to parse Excel output: ${stdout.slice(0, 500)}`,
        code: 'BAD_OUTPUT',
        details: { processingTime },
      };
    }
  }
}
