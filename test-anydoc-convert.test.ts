import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { PptMasterService } from './src/ppt-master-service.js';

const FIXTURES = path.join(process.cwd(), 'anydoc/tests/fixtures');

// anydoc 原生覆盖的 office 格式（每个格式一个真实 fixture）
const OFFICE_CASES = [
  'doc/text.doc',
  'docx/text.docx',
  'odt/text.odt',
  'rtf/text.rtf',
  'epub/book.epub',
  'xls/sheet.xls',
  'xlsx/sheet.xlsx',
  'ppt/pres.ppt',
  'pptx/pres.pptx',
] as const;

describe('convert_to_markdown · anydoc office 内核', () => {
  let work: string;
  const service = new PptMasterService();

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'anydoc-test-'));
  });

  afterAll(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });

  for (const file of OFFICE_CASES) {
    it(`由 anydoc 转换 ${file}`, async () => {
      const out = path.join(work, file.replace(/\//g, '_').replace(/\.[^.]+$/, '') + '.md');
      const result = await service.convertToMarkdown({
        source: path.join(FIXTURES, file),
        outputPath: out,
      });

      expect(result.success, result.error).toBe(true);
      expect(result.markdownPath).toBe(out);
      const md = await fs.readFile(out, 'utf-8');
      expect(md.trim().length).toBeGreaterThan(0);
    });
  }

  it('docx 内嵌资产落盘到 <md>_files/', async () => {
    const out = path.join(work, 'rich.md');
    const result = await service.convertToMarkdown({
      source: path.join(FIXTURES, 'docx/handmade-rich.docx'),
      outputPath: out,
    });

    expect(result.success, result.error).toBe(true);
    expect(result.details?.assetCount ?? 0).toBeGreaterThan(0);
    expect(result.assetsDir).toBe(path.join(work, 'rich_files'));
    const files = await fs.readdir(path.join(work, 'rich_files'));
    expect(files.length).toBe(result.details?.assetCount);
  });

  it('.docm 扩展名可自动识别并转换', async () => {
    // 用 docx 的内容另存为 .docm（OOXML 包），验证 detect + anydoc 的 docm→doc 映射
    const msrc = path.join(work, 'copied.docm');
    await fs.copyFile(path.join(FIXTURES, 'docx/text.docx'), msrc);
    const out = path.join(work, 'copied-docm.md');

    const result = await service.convertToMarkdown({ source: msrc, outputPath: out });
    expect(result.success, result.error).toBe(true);
    expect(result.details?.sourceType).toBe('doc');
    const md = await fs.readFile(out, 'utf-8');
    expect(md.trim().length).toBeGreaterThan(0);
  });

  it('.potx（anydoc 与 python-pptx 均不支持）给出明确错误而非静默失败', async () => {
    const msrc = path.join(work, 'tpl.potx');
    await fs.copyFile(path.join(FIXTURES, 'pptx/pres.pptx'), msrc);

    // 自动检测：detectSourceType 不再识别 .potx，应报可操作错误
    const auto = await service.convertToMarkdown({ source: msrc });
    expect(auto.success).toBe(false);
    expect(auto.error).toMatch(/Cannot detect source type/i);

    // 显式 sourceType=ppt：Python 回退分支应主动拒绝模板格式
    const explicit = await service.convertToMarkdown({ source: msrc, sourceType: 'ppt' });
    expect(explicit.success).toBe(false);
    expect(explicit.error).toMatch(/PowerPoint template formats/i);
  });

  it('.xls（旧版二进制，原 openpyxl 不支持）可转换', async () => {
    const out = path.join(work, 'sheet.md');
    const result = await service.convertToMarkdown({
      source: path.join(FIXTURES, 'xls/sheet.xls'),
      outputPath: out,
    });
    expect(result.success, result.error).toBe(true);
    const md = await fs.readFile(out, 'utf-8');
    expect(md).toContain('|');
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

  it("sourceType: 'auto' 显式传入会被规约到 detect 结果", async () => {
    const out = path.join(work, 'auto-detect.md');
    const result = await service.convertToMarkdown({
      source: path.join(FIXTURES, 'docx/text.docx'),
      sourceType: 'auto',
      outputPath: out,
    });
    expect(result.success, result.error).toBe(true);
    expect(result.details?.sourceType).toBe('doc');
  });
});