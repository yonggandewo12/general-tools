import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import MarkdownIt from 'markdown-it';
import { PptMasterService } from '../src/ppt-master-service.js';

const execFileAsync = promisify(execFile);

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

/** xlsx：A 列百分比(内置 10)、B 列自定义货币(164)、C 列通用整数、D 列通用浮点。 */
async function makeStyledXlsx(target: string): Promise<void> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
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
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>');
  zip.file('xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>' +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>');
  zip.file('xl/worksheets/sheet1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    '<row r="1">' +
    '<c r="A1" t="inlineStr"><is><t>pct</t></is></c>' +
    '<c r="B1" t="inlineStr"><is><t>money</t></is></c>' +
    '<c r="C1" t="inlineStr"><is><t>count</t></is></c>' +
    '<c r="D1" t="inlineStr"><is><t>float</t></is></c></row>' +
    '<row r="2">' +
    '<c r="A2" s="1"><v>0.125</v></c>' +
    '<c r="B2" s="2"><v>1234.5</v></c>' +
    '<c r="C2"><v>9876543</v></c>' +
    '<c r="D2"><v>-9876.543</v></c></row>' +
    '</sheetData></worksheet>');
  await fs.writeFile(target, await zip.generateAsync({ type: 'nodebuffer' }));
}

/** docx：一个 OMML 分式。0.1.x 内核会整段丢掉公式。 */
async function makeMathDocx(target: string): Promise<void> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>' +
    '<w:p><w:r><w:t xml:space="preserve">Fraction: </w:t></w:r>' +
    '<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num>' +
    '<m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>' +
    '<w:r><w:t xml:space="preserve"> end</w:t></w:r></w:p>' +
    '</w:body></w:document>');
  await fs.writeFile(target, await zip.generateAsync({ type: 'nodebuffer' }));
}

const PNG_4X4 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4nGP8//8/Ay4gxMAOGMUAGx0AAB8VCwp0ZPh+AAAAAElFTkSuQmCC',
  'base64',
);

/** 生成只含一个章节的最小 epub；body 决定块顺序，images 是章内引用的图片文件名。 */
async function makeEpub(
  target: string,
  body: string,
  images: string[] = ['a.png', 'b.png', 'c.png'],
): Promise<void> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf',
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier>' +
    '<dc:title>T</dc:title><dc:language>en</dc:language>' +
    '<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta></metadata>' +
    '<manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>' +
    images.map((name, i) => `<item id="i${i}" href="images/${name}" media-type="image/png"/>`).join('') +
    '</manifest><spine><itemref idref="ch1"/></spine></package>');
  zip.file('OEBPS/chapter1.xhtml',
    '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body>' +
    body + '</body></html>');
  for (const name of images) zip.file(`OEBPS/images/${name}`, PNG_4X4);
  await fs.writeFile(target, await zip.generateAsync({ type: 'nodebuffer' }));
}

/** epub：a.png 独立成段且带 alt，b.png 独立成段但 alt 为空（无法锚定）。 */
async function makeImageEpub(target: string): Promise<void> {
  await makeEpub(
    target,
    '<p>PRE-TEXT</p><p><img src="images/a.png" alt="Cat logo"/></p>' +
    '<p><img src="images/b.png" alt=""/></p><p>POST-TEXT</p>',
    ['a.png', 'b.png'],
  );
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
    for (const ext of ['.xls', '.xlsb', '.ods', '.csv']) {
      const src = path.join(work, `fake${ext}`);
      await fs.writeFile(src, '');  // 空文件，仅用于扩展名检测
      const result = await spy.convertToMarkdown({ source: src, maxRows: 1 });
      expect(result.success, `${ext} should return error: ${result.error}`).toBe(false);
      expect(result.error).toMatch(/maxRows\/maxCols is not supported/i);
      // 报错要点名 maxRows 才是根因，否则用户以为文件坏了
      expect(result.error).toMatch(/Python fallback/);
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

/**
 * 锁定 anydoc 0.2.x 内核的可观测行为：公式、Excel 数字格式、图片资产链接。
 * 0.1.9 上这三条全部失败——误降级或上游回归时这里会红。
 */
describe('convert_to_markdown · anydoc 输出质量', () => {
  let work: string;
  let svc: PptMasterService;

  beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'anydoc-quality-'));
    svc = new PptMasterService();
  });

  afterAll(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });

  it('Word 公式转 LaTeX，不再静默丢弃', async () => {
    const src = path.join(work, 'math.docx');
    await makeMathDocx(src);
    const out = path.join(work, 'math.md');
    const result = await svc.convertToMarkdown({ source: src, outputPath: out });
    expect(result.success, result.error).toBe(true);
    const md = await fs.readFile(out, 'utf-8');
    expect(md).toContain('$\\frac{1}{2}$');
  });

  it('Excel 单元格数字格式生效，通用格式大整数不切科学计数', async () => {
    const src = path.join(work, 'fmt.xlsx');
    await makeStyledXlsx(src);
    const out = path.join(work, 'fmt.md');
    const result = await svc.convertToMarkdown({ source: src, outputPath: out });
    expect(result.success, result.error).toBe(true);
    const md = await fs.readFile(out, 'utf-8');
    expect(md).toContain('12.50%');
    expect(md).toContain('$1,234.50');
    expect(md).toContain('9876543');
    expect(md).toContain('-9876.543');
    expect(md).not.toMatch(/9\.87654e\+06/i);
  });

  // 走 Python 子进程：CI runner 冷启动（解释器探测 + import 链）可超 vitest
  // 默认 5s，留 30s 余量
  it('maxRows 截断走 Python，并提示数字格式差异', { timeout: 30_000 }, async () => {
    const src = path.join(work, 'trunc.xlsx');
    await makeStyledXlsx(src);
    const out = path.join(work, 'trunc.md');
    const result = await svc.convertToMarkdown({ source: src, outputPath: out, maxRows: 2 });
    expect(result.success, result.error).toBe(true);
    const md = await fs.readFile(out, 'utf-8');
    expect(md).toContain('9876543');
    // Python 引擎不套数字格式，必须明说而不是让用户自己发现
    expect(result.warnings?.join(' ')).toMatch(/number formats/i);
    // 注意：这条走的是 runtime 子包里捆绑的那份脚本快照（本机 1.9.5），不是仓库里的
    // excel_to_md.py；所以数字精度由下面那条直接执行仓库脚本的用例锁定。
  });

  it('仓库里的 excel_to_md.py 不再用 %g 截断浮点', async () => {
    const script = fileURLToPath(
      new URL('../scripts/ppt-master/scripts/source_to_md/excel_to_md.py', import.meta.url),
    );
    const src = path.join(work, 'floats.xlsx');
    await makeStyledXlsx(src);
    const out = path.join(work, 'floats.md');
    await execFileAsync('python3', [script, src, '-o', out]);
    const md = await fs.readFile(out, 'utf-8');
    // D 列 openpyxl 读成 float：`%g` 只有 6 位有效数字，-9876.543 会被截成 -9876.54
    expect(md).toContain('-9876.543');
    expect(md).not.toMatch(/-9876\.54(?!\d)/);
  });

  it('内嵌图片回填成 Markdown 链接，空 alt 进清单并告警', async () => {
    const src = path.join(work, 'book.epub');
    await makeImageEpub(src);
    const out = path.join(work, 'book.md');
    // 上一轮留下的清单点名的文件该删；没被点名的（用户自己的图、外来文件、
    // 清单里伪造的越界路径）一个都不能动
    await fs.mkdir(path.join(work, 'book_files'), { recursive: true });
    await fs.writeFile(path.join(work, 'book_files', 'book-9.png'), 'stale');
    await fs.writeFile(path.join(work, 'book_files', 'book-2024.png'), 'user photo');
    await fs.writeFile(path.join(work, 'book_files', 'notes.txt'), 'mine');
    await fs.writeFile(path.join(work, 'outside.png'), 'do not touch');
    await fs.writeFile(
      path.join(work, 'book_files', 'image_manifest.json'),
      JSON.stringify([
        { filename: 'book-9.png' },
        { filename: '../outside.png' },
        { filename: 'sub/nested.png' },
      ]),
      'utf-8',
    );

    const result = await svc.convertToMarkdown({ source: src, outputPath: out });
    expect(result.success, result.error).toBe(true);

    const md = await fs.readFile(out, 'utf-8');
    expect(md).toContain('![Cat logo](book_files/book-0.png)');
    expect(result.assetsDir).toBe(path.join(work, 'book_files'));
    expect(result.details?.assetCount).toBe(2);
    await expect(fs.stat(path.join(work, 'book_files', 'book-1.png'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(work, 'book_files', 'book-9.png'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(work, 'book_files', 'book-2024.png'), 'utf-8')).resolves.toBe('user photo');
    await expect(fs.readFile(path.join(work, 'book_files', 'notes.txt'), 'utf-8')).resolves.toBe('mine');
    await expect(fs.readFile(path.join(work, 'outside.png'), 'utf-8')).resolves.toBe('do not touch');

    const manifest = JSON.parse(
      await fs.readFile(path.join(work, 'book_files', 'image_manifest.json'), 'utf-8'),
    ) as Array<{ filename: string; occurrences: Array<{ linked_in_markdown: boolean }> }>;
    expect(manifest.find((e) => e.filename === 'book-0.png')?.occurrences[0]?.linked_in_markdown).toBe(true);
    expect(manifest.find((e) => e.filename === 'book-1.png')?.occurrences[0]?.linked_in_markdown).toBe(false);
    expect(result.warnings?.join(' ')).toMatch(/could not be linked/);
  });

  it('图片定位按块顺序，不被同名正文行抢走；alt 里的 Markdown 转义也能锚定', async () => {
    const src = path.join(work, 'tricky.epub');
    await makeEpub(
      src,
      // 第 1 段是用户自己写的正文，与后面图片的 alt 一字不差；
      // 第 2 张图 alt 含 [ ] \ ，anydoc 渲染时会加反斜杠转义；
      // 第 3 张是行内图，留在句子里。
      '<p>Cat logo</p>' +
      '<p><img src="images/a.png" alt="Cat logo"/></p>' +
      '<p><img src="images/b.png" alt="A (big) [test] \\ back"/></p>' +
      '<p>see <img src="images/c.png" alt="Inline"/> here</p>',
      ['a.png', 'b.png', 'c.png'],
    );
    const out = path.join(work, 'tricky.md');
    const result = await svc.convertToMarkdown({ source: src, outputPath: out });
    expect(result.success, result.error).toBe(true);

    const md = await fs.readFile(out, 'utf-8');
    const lines = md.split('\n');
    // 正文行必须还是正文，链接必须落在图片自己那一行（早先按 alt 全文搜索会写反）
    expect(lines).toContain('Cat logo');
    expect(lines.indexOf('![Cat logo](tricky_files/tricky-0.png)')).toBeGreaterThan(
      lines.indexOf('Cat logo'),
    );
    // 转义后的形态：链接文本里的方括号必须配对，否则整行在 CommonMark 里退化成字面文本
    expect(lines).toContain('![A (big) \\[test\\] \\\\ back](tricky_files/tricky-1.png)');
    expect(lines).toContain('see Inline here');
    // 行内图无法锚定，只能落盘 + 告警
    expect(result.warnings?.join(' ')).toMatch(/could not be linked/);
    expect(result.details?.assetCount).toBe(3);

    // 最终验收：markdown 解析器真的把它们当图片，而不是一行文字
    const tokens = new MarkdownIt().parse(md, []);
    const images: string[] = [];
    for (const token of tokens) {
      if (token.type === 'inline' && token.children) {
        for (const child of token.children) {
          if (child.type === 'image') images.push(String(child.attrs?.[0]?.[1]));
        }
      }
    }
    expect(images).toHaveLength(2);
    for (const src of images) {
      await expect(fs.stat(path.resolve(path.dirname(out), decodeURIComponent(src)))).resolves.toBeTruthy();
    }
  });

  it('代码块与水平线也占段落组，后面的图片不会集体失联', async () => {
    const src = path.join(work, 'code.epub');
    await makeEpub(
      src,
      '<pre>CODE LINE</pre><p><img src="images/a.png" alt="Alpha"/></p>' +
      '<hr/><p><img src="images/b.png" alt="Beta"/></p>',
      ['a.png', 'b.png'],
    );
    const out = path.join(work, 'code.md');
    const result = await svc.convertToMarkdown({ source: src, outputPath: out });
    expect(result.success, result.error).toBe(true);
    const md = await fs.readFile(out, 'utf-8');
    expect(md).toContain('![Alpha](code_files/code-0.png)');
    expect(md).toContain('![Beta](code_files/code-1.png)');
    expect(result.warnings).toBeUndefined();
  });

  it('输出名带空格和括号时链接目标百分号编码，链接仍能指到真实文件', async () => {
    const src = path.join(work, 'spaced source.epub');
    await makeEpub(src, '<p><img src="images/a.png" alt="Cat logo"/></p>', ['a.png']);
    const out = path.join(work, 'Q3 Report (final).md');
    const result = await svc.convertToMarkdown({ source: src, outputPath: out });
    expect(result.success, result.error).toBe(true);

    const md = await fs.readFile(out, 'utf-8');
    const destination = /\]\(([^)]*)\)/.exec(md)?.[1];
    expect(destination).toBeDefined();
    // CommonMark 的裸目标里不能有空格，否则整行退化成字面文本
    expect(destination).not.toMatch(/\s/);
    const resolved = path.resolve(path.dirname(out), decodeURIComponent(destination!));
    await expect(fs.stat(resolved)).resolves.toBeTruthy();
    expect(resolved).toBe(path.join(work, 'Q3 Report (final)_files', 'Q3 Report (final)-0.png'));
  });
});
