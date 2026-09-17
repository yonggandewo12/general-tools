import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import JSZip from 'jszip';
import { PptMasterService } from '../src/ppt-master-service.js';

/** 生成 anydoc 可转换的最小 xlsx（含 Sheet1 两行数据）。 */
async function makeXlsx(target: string): Promise<void> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>');
  zip.file('xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>');
  zip.file('xl/worksheets/sheet1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Region</t></is></c><c r="B1" t="inlineStr"><is><t>Q1</t></is></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>East</t></is></c><c r="B2"><v>100</v></c></row>' +
    '</sheetData></worksheet>');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(target, buf);
}

describe('convert_to_markdown · anydoc office 内核', () => {
  let work: string;
  let sheet: string;

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'anydoc-test-'));
    sheet = path.join(work, 'sheet.xlsx');
    await makeXlsx(sheet);
  });

  afterAll(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });

  it('Excel 指定 maxRows/maxCols 时回退 Python 以保留截断语义（默认走 anydoc）', async () => {
    // mock runner：若走了 Python run() 会被调用；anydoc 路径则不会
    const run = vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }));
    const runner = { checkPython: vi.fn(async () => {}), checkPackages: vi.fn(async () => []), run };
    const spy = new PptMasterService(runner as never);

    // 不指定截断选项 → anydoc 路径，不调用 Python run()
    const out1 = path.join(work, 'sheet-anydoc.md');
    const plain = await spy.convertToMarkdown({ source: sheet, outputPath: out1 });
    expect(plain.success, plain.error).toBe(true);
    expect(run).not.toHaveBeenCalled();
    const md1 = await fs.readFile(out1, 'utf-8');
    expect(md1).toContain('Region');
    expect(md1).toContain('East');

    // 指定 maxRows → 强制 convertViaPython → 调用 excel_to_md.py
    const out2 = path.join(work, 'sheet-capped.md');
    const capped = await spy.convertToMarkdown({ source: sheet, outputPath: out2, maxRows: 1 });
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

  it('renderVectorFigures 未实现：成功结果必须带 warnings，而非静默忽略', async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }));
    const runner = { checkPython: vi.fn(async () => {}), checkPackages: vi.fn(async () => []), run };
    const spy = new PptMasterService(runner as never);
    // 假 xlsx + maxRows 强制走 Python 路径（mock run 返回成功），不依赖真实转换
    const src = path.join(work, 'warn-src.xlsx');
    await fs.writeFile(src, '');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = path.join(work, 'sheet-warn.md');
      const result = await spy.convertToMarkdown({
        source: src,
        outputPath: out,
        maxRows: 1,
        renderVectorFigures: true,
        vectorFigureDpi: 300,
      });
      expect(result.success, result.error).toBe(true);
      expect(result.warnings?.length).toBeGreaterThan(0);
      expect(result.warnings![0]).toMatch(/renderVectorFigures\/vectorFigureDpi.*not implemented/);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
