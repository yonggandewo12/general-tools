import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { PptMasterService } from '../src/ppt-master-service.js';

const FIXTURES = path.join(process.cwd(), 'anydoc/tests/fixtures');

describe('convert_to_markdown · anydoc office 内核', () => {
  let work: string;

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'anydoc-test-'));
  });

  afterAll(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });

  it('Excel 指定 maxRows/maxCols 时回退 Python 以保留截断语义（默认走 anydoc）', async () => {
    // mock runner：若走了 Python run() 会被调用；anydoc 路径则不会
    const run = vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }));
    const runner = { checkPython: vi.fn(async () => {}), checkPackages: vi.fn(async () => []), run };
    const spy = new PptMasterService(runner as never);
    const src = path.join(FIXTURES, 'xlsx/sheet.xlsx');

    // 不指定截断选项 → anydoc 路径，不调用 Python run()
    const out1 = path.join(work, 'sheet-anydoc.md');
    await spy.convertToMarkdown({ source: src, outputPath: out1 });
    expect(run).not.toHaveBeenCalled();

    // 指定 maxRows → 强制 convertViaPython → 调用 excel_to_md.py
    const out2 = path.join(work, 'sheet-capped.md');
    const capped = await spy.convertToMarkdown({ source: src, outputPath: out2, maxRows: 1 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toContain('excel_to_md.py');
    expect(capped.success, capped.error).toBe(true);
  });

  it('maxRows 对 anydoc 独享格式 (.xls/.xlsb/.ods/.csv) 给可操作错误而非回退 Python', async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }));
    const runner = { checkPython: vi.fn(async () => {}), checkPackages: vi.fn(async () => []), run };
    const spy = new PptMasterService(runner as never);

    // .xls/.xlsb/.ods/.csv 都是 anydoc 独享格式，Python excel_to_md.py 不支持。
    // 强制回退 Python 路径应给出明确错误，而不是去调用到一个会失败的脚本。
    for (const ext of ['.xlsb', '.ods', '.csv']) {
      const src = path.join(work, `fake${ext}`);
      await fs.writeFile(src, '');  // 空文件，仅用于扩展名检测
      const result = await spy.convertToMarkdown({ source: src, maxRows: 1 });
      expect(result.success, `${ext} should return error: ${result.error}`).toBe(false);
      expect(result.error).toMatch(/maxRows\/maxCols is not supported/i);
      expect(run, `${ext} should not even reach Python`).not.toHaveBeenCalled();
    }
  });
});