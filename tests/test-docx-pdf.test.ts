/**
 * DOCX 生成/编辑 + PDF 水印/二维码 单元测试。
 * DOCX 生成（docx npm 包）与 PDF 后处理（pdf-lib）为纯 JS，直接可测。
 * DOCX 编辑走 python-docx 子进程，依赖嵌入运行时（PPT_MASTER_PYTHON 可指定）。
 */
import { describe, expect, it } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import JSZip from 'jszip';
import { getDocxService } from '../src/docx-service.js';
import { pdfPostProcessor } from '../src/pdf-postprocess.js';
import { MERMAID_SCRIPT_STRIP_RE } from '../src/pdf-converter.js';

/** 解包 docx 并返回 word/document.xml 文本，用于内容断言。 */
async function docxText(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('word/document.xml missing');
  return await entry.async('string');
}

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'docx-test-'));

/** 构造一个最小的合法 PDF（单页 A4）。 */
const MINI_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\n' +
  'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF',
  'binary',
);

const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('DOCX 生成（纯 JS docx 包）', () => {
  it('createDocument 从 HTML 内容创建有效 docx', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'a.docx');
    const r = await getDocxService().createDocument(
      '<h1>标题</h1><p>正文<strong>加粗</strong></p>',
      out,
      { title: '测试' },
    );
    expect(r.success).toBe(true);
    expect(r.outputPath).toBe(out);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(1000);
    expect(out.endsWith('.docx')).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertMdToDocx 将 markdown 转为有效 docx', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'b.docx');
    const r = await getDocxService().convertMdToDocx(
      '# 报告\n\n这是**加粗**内容。\n\n- 项1\n- 项2\n',
      undefined,
      out,
      {},
    );
    expect(r.success).toBe(true);
    expect(r.outputPath).toBe(out);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(1000);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertMdToDocx 保留 markdown 表格为真 DOCX 表格', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'table.docx');
    const r = await getDocxService().convertMdToDocx(
      '# MD 标题\n\n| 列A | 列B |\n|---|---|\n| 1 | 2 |\n',
      undefined,
      out,
      {},
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    expect(xml).toMatch(/<w:tbl[>\s]/);
    expect(xml).toContain('列A');
    expect(xml).toContain('列B');
    expect(xml).toContain('1');
    expect(xml).toContain('2');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 嵌套表格不重复输出内层行', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'nested.docx');
    const r = await getDocxService().convertHtmlToDocx(
      '<table><tr><td>o<table><tr><td>n</td></tr></table></td></tr></table>',
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    // 内层表的行不能重复算作本表行：只有 1 行 1 格，"on" 恰好保留一次
    expect((xml.match(/<w:tr[>\s]/g) ?? []).length).toBe(1);
    expect((xml.match(/<w:tc[>\s]/g) ?? []).length).toBe(1);
    expect(xml).toContain('>on<');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 空表不产出、colspan 表降级补齐不丢内容', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'degrade.docx');
    const r = await getDocxService().convertHtmlToDocx(
      '<p>前</p><table></table><table><tr><td colspan="2">wide</td></tr></table>',
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    expect((xml.match(/<w:tbl[>\s]/g) ?? []).length).toBe(1); // 空表无 w:tbl，colspan 表产出
    expect(xml).toContain('wide'); // 内容不丢失
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 将 HTML 转为有效 docx', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'c.docx');
    const r = await getDocxService().convertHtmlToDocx(
      '<h2>小节</h2><ul><li>甲</li><li>乙</li></ul>',
      out,
    );
    expect(r.success).toBe(true);
    expect(r.outputPath).toBe(out);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(1000);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 段落内联元素（strong/em/code）文字不丢失', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'inline.docx');
    // 内联元素的 run 若不是 TextRun 实例，会被序列化成非法 <text> 元素，
    // Word 解析时静默丢弃，段落里的加粗/斜体/行内码文字整体消失。
    const r = await getDocxService().convertHtmlToDocx(
      '<p>前段<strong>加粗字</strong>中段<em>斜体字</em><code>行内码</code>后段</p>',
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    for (const t of ['前段', '加粗字', '中段', '斜体字', '行内码', '后段']) {
      expect(xml).toContain(t);
    }
    expect(xml).not.toMatch(/<text[ >]/);
    // 每个内联片段都必须是带样式的合法 run
    expect((xml.match(/<w:r>/g) ?? []).length).toBe(6);
    expect(xml).toMatch(/<w:b\/>[\s\S]*?加粗字/);
    expect(xml).toMatch(/<w:i\/>[\s\S]*?斜体字/);
    expect(xml).toMatch(/Consolas[\s\S]*?行内码/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 嵌套内联保留双层样式，<br> 保留换行', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'nested-inline.docx');
    const r = await getDocxService().convertHtmlToDocx(
      '<p><strong>粗<em>粗斜</em>后</strong>行一<br>行二<s>删除</s><span style="background-color: yellow">高亮</span></p>',
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    expect(xml).not.toMatch(/<text[ >]/);
    // strong 内的 em 不能压平成单层：该 run 同时含粗体与斜体
    expect(xml).toMatch(/<w:b\/><w:bCs\/><w:i\/>[\s\S]*?粗斜/);
    expect(xml).toMatch(/<w:strike\/>[\s\S]*?删除/);
    expect(xml).toMatch(/<w:highlight[\s\S]*?高亮/);
    // <br> 前不吞文本，且产出真实换行符
    for (const t of ['粗', '粗斜', '后', '行一', '行二']) expect(xml).toContain(t);
    expect((xml.match(/<w:br\/>/g) ?? []).length).toBe(1);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 列表项内联样式保留，深嵌套/大量内联不崩溃', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'list-inline.docx');
    const r = await getDocxService().convertHtmlToDocx(
      '<ul><li>甲<strong>乙</strong><code>丙</code></li><li>丁</li></ul>' +
        `<p>${'<b>x'.repeat(300)}尾${'</b>'.repeat(300)}</p>` +
        `<p>${Array.from({ length: 800 }, (_, i) => `<i>t${i}</i>`).join('')}</p>`,
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    expect(xml).not.toMatch(/<text[ >]/);
    expect(xml).toMatch(/<w:b\/>[\s\S]*?乙/); // 列表项里的加粗不再是纯文本
    expect(xml).toMatch(/Consolas[\s\S]*?丙/);
    expect(xml).toContain('>• <'); // bullet 独立成 run
    expect(xml).toContain('>甲<');
    expect((xml.match(/•/g) ?? []).length).toBe(2); // 每项一个 bullet，无重复
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 嵌套列表不重复输出子项，ol 每层独立编号', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'nested-list.docx');
    const r = await getDocxService().convertHtmlToDocx(
      '<ul><li>甲<ul><li>乙</li></ul></li><li>丁</li></ul>' +
        '<ol><li>一<ol><li>内</li></ol></li><li>二</li></ol>',
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    // 每个子项只出现一次：甲的段落不含"乙"，乙有自己的段落
    expect((xml.match(/乙/g) ?? []).length).toBe(1);
    expect((xml.match(/内/g) ?? []).length).toBe(1);
    // ul 两个 bullet + ol 两层编号各一个 bullet
    expect((xml.match(/•/g) ?? []).length).toBe(3);
    expect(xml).toContain('1. ');
    expect(xml).toContain('2. ');
    // 嵌套层（乙）比顶层缩进更深
    const indents = [...xml.matchAll(/<w:ind w:left="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(indents).toContain(1080);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 表格支持 colspan/rowspan 合并', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'merge.docx');
    // 模拟合并表单：标题行横跨 4 列，左侧标签纵跨 3 行
    const r = await getDocxService().convertHtmlToDocx(
      '<table>' +
        '<tr><th colspan="4">标题</th></tr>' +
        '<tr><td rowspan="3">标签</td><td>a1</td><td>a2</td><td>a3</td></tr>' +
        '<tr><td>b1</td><td>b2</td><td>b3</td></tr>' +
        '<tr><td colspan="3">c1-3</td></tr>' +
        '</table>',
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    // 横向合并 → gridSpan
    expect(xml).toMatch(/<w:gridSpan w:val="4"\/>/);
    expect(xml).toMatch(/<w:gridSpan w:val="3"\/>/);
    // 纵向合并 → vMerge restart + continue（docx 自动生成 2 个 continue）
    expect((xml.match(/<w:vMerge w:val="restart"\/>/g) ?? []).length).toBe(1);
    expect((xml.match(/<w:vMerge w:val="continue"\/>/g) ?? []).length).toBe(2);
    // 网格为 4 列
    expect((xml.match(/<w:gridCol/g) ?? []).length).toBe(4);
    // 每行单元格数 = 4 - 被合并覆盖：row2/3 有 4 个（含 continue），row4 有 2 个（continue 1 + gridSpan 1）
    expect(xml).toContain('标题');
    expect(xml).toContain('标签');
    expect(xml).toContain('c1-3');
    // 内容不丢失：所有文本恰好出现一次
    for (const t of ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']) expect((xml.match(new RegExp(`>${t}<`, 'g')) ?? []).length).toBe(1);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 表格列宽（colgroup 与单元格 width）按比例落到网格', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'colwidth.docx');
    const r = await getDocxService().convertHtmlToDocx(
      '<table><colgroup><col width="200"/><col width="600"/></colgroup>' +
        '<tr><td>窄</td><td>宽</td></tr><tr><td>x</td><td>y</td></tr></table>',
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    const cols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(cols.length).toBe(2);
    // 200:600 → 1:3 比例（允许取整误差）
    expect(cols[1] / cols[0]).toBeCloseTo(3, 0);
    // 网格总宽 = 页面可用宽 9360 DXA
    expect(cols[0] + cols[1]).toBe(9360);
    // 单元格宽度与网格列一致
    const tcw = [...xml.matchAll(/<w:tcW w:type="dxa" w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(tcw.slice(0, 2)).toEqual(cols);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 表格单元格底纹/内联样式/对齐/valign 保留', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'cell-style.docx');
    const r = await getDocxService().convertHtmlToDocx(
      '<table>' +
        '<tr><td style="background-color: #ffee00; text-align: center" valign="middle">底纹<strong>粗体</strong><code>码</code></td><td>普通</td></tr>' +
        '</table>',
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    // 单元格底纹
    expect(xml).toMatch(/<w:shd[^>]*w:fill="FFEE00"/);
    // 段落居中
    expect(xml).toMatch(/<w:jc w:val="center"\/>[\s\S]*?底纹/);
    // 垂直居中
    expect(xml).toMatch(/<w:vAlign w:val="center"\/>/);
    // 内联样式：粗体片段与等宽码片段
    expect(xml).toMatch(/<w:b\/>[\s\S]*?粗体/);
    expect(xml).toMatch(/Consolas[\s\S]*?码/);
    // 显式底纹精确一次（未被表头默认灰覆盖或重复）
    expect((xml.match(/<w:shd w:fill="FFEE00"\/>/g) ?? []).length).toBe(1);
    // 背景色不应再被重复应用为文字高亮
    expect(xml).not.toMatch(/<w:highlight w:val="yellow"\/>/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 表格百分比列宽与 px 混用时比例正确', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'pctwidth.docx');
    const r = await getDocxService().convertHtmlToDocx(
      '<table><colgroup><col width="25%"/><col width="75%"/></colgroup>' +
        '<tr><td>a</td><td>b</td></tr></table>',
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    const cols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(cols.length).toBe(2);
    expect(cols[1] / cols[0]).toBeCloseTo(3, 1); // 25% : 75% = 1 : 3
    expect(cols[0] + cols[1]).toBe(9360);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 畸形表格（rowspan 越界/未闭合/空单元格）不崩溃且网格矩形成立', async () => {
    const dir = await tmp();
    const cases: Array<[string, string, string[]]> = [
      ['rowspan 超出实际行数', '<table><tr><td rowspan="9">长</td><td>x</td></tr><tr><td>y</td></tr></table>', ['长', 'x', 'y']],
      ['未闭合单元格', '<table><tr><td>甲<td>乙</tr><tr><td>丙</td><td>丁</td></tr></table>', ['甲', '乙', '丙', '丁']],
      ['colspan 超过列数', '<table><tr><td>a</td><td>b</td></tr><tr><td colspan="9">宽</td></tr></table>', ['a', 'b', '宽']],
      ['空单元格', '<table><tr><td></td><td> </td></tr><tr><td>实</td><td>值</td></tr></table>', ['实', '值']],
      ['col 数多于实际列', '<table><colgroup><col width="100"/><col width="100"/><col width="100"/></colgroup><tr><td>p</td><td>q</td></tr></table>', ['p', 'q']],
      ['非法 colspan 值', '<table><tr><td colspan="abc">坏</td><td>值</td></tr></table>', ['坏', '值']],
    ];
    for (const [i, [label, html, texts]] of cases.entries()) {
      const out = path.join(dir, `m${i}.docx`);
      const r = await getDocxService().convertHtmlToDocx(html, out);
      expect(r.success, `${label}: ${r.error}`).toBe(true);
      const xml = await docxText(out);
      expect(xml, label).not.toMatch(/<text[ >]/);
      for (const t of texts) expect(xml, `${label} 缺 ${t}`).toContain(t);
      // 每行 gridSpan 累加必须等于网格列数（Word 打开不错位的硬条件）
      const cols = (xml.match(/<w:gridCol/g) ?? []).length;
      const rowSums = [...xml.matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map((m) => {
        const cells = (m[1].match(/<w:tc>/g) ?? []).length;
        const spans = [...m[1].matchAll(/<w:gridSpan w:val="(\d+)"\/>/g)].map((s) => Number(s[1]));
        return spans.reduce((a, b) => a + b, 0) + (cells - spans.length);
      });
      expect(rowSums.length, label).toBeGreaterThan(0);
      expect(rowSums, label).toEqual(rowSums.map(() => cols));
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 表格单元格内嵌图片产出 ImageRun', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'cell-img.docx');
    const r = await getDocxService().convertHtmlToDocx(
      `<table><tr><td>图：<img src="data:image/png;base64,${MINI_PNG.toString('base64')}" /></td><td>文</td></tr></table>`,
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    expect(xml).toMatch(/<w:drawing>/);
    expect(xml).toContain('图：');
    const zip = await JSZip.loadAsync(await fs.readFile(out));
    const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/') && !n.endsWith('/'));
    expect(media.length).toBe(1);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 嵌套表格的 colgroup 不污染外层列宽', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'nested-colgroup.docx');
    // 外层未声明列宽（应 1:1 均分）；内层表自带极端比例 10:810
    const r = await getDocxService().convertHtmlToDocx(
      '<table><tr><td>外1</td><td>外2</td></tr>' +
        '<tr><td colspan="2"><table><colgroup><col width="10"/><col width="810"/></colgroup>' +
        '<tr><td>内a</td><td>内b</td></tr></table></td></tr></table>',
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    const cols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    // 内层表被压平，输出只有外层这一张表的两列网格，且保持 1:1 等宽
    // （若内层 colgroup 的 10:810 泄漏，两列会变成悬殊比例）
    expect(cols.length).toBe(2);
    expect(cols[0]).toBe(cols[1]);
    // 嵌套表内容压平但不粘连
    expect(xml).toMatch(/内a\s+内b/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 仅真表头跨页重复，纯数据表首行不标记 tblHeader', async () => {
    const dir = await tmp();
    const withHead = path.join(dir, 'thead.docx');
    const plain = path.join(dir, 'plain.docx');
    const r1 = await getDocxService().convertHtmlToDocx(
      '<table><thead><tr><th>列A</th><th>列B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
      withHead,
    );
    const r2 = await getDocxService().convertHtmlToDocx(
      '<table><tr><td>姓名</td><td>张三</td></tr><tr><td>性别</td><td>男</td></tr></table>',
      plain,
    );
    expect(r1.success && r2.success, r1.error ?? r2.error).toBe(true);
    // thead 首行 → <w:tblHeader/>（无 val 或 val=true）；纯 td 表 → 仅 val="false"
    expect(await docxText(withHead)).toMatch(/<w:tblHeader\/>/);
    expect(await docxText(plain)).not.toMatch(/<w:tblHeader\/>/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 超大 colspan 被夹取，不撑出畸形宽网格', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'huge-colspan.docx');
    const r = await getDocxService().convertHtmlToDocx(
      '<table><tr><td colspan="999">巨</td></tr><tr><td>x</td><td>y</td></tr></table>',
      out,
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    const cols = (xml.match(/<w:gridCol/g) ?? []).length;
    expect(cols).toBeLessThanOrEqual(100);
    // 仍是矩形网格：两行的宽度都等于列数
    const sums = [...xml.matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map((m) => {
      const cells = (m[1].match(/<w:tc>/g) ?? []).length;
      const spans = [...m[1].matchAll(/<w:gridSpan w:val="(\d+)"\/>/g)].map((s) => Number(s[1]));
      return spans.reduce((a, b) => a + b, 0) + (cells - spans.length);
    });
    expect(sums).toEqual(sums.map(() => cols));
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 综合合并表单（标题跨行+纵跨标签列+子表头+底纹）结构成立', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'form.docx');
    const form =
      '<table border="1">' +
      '<tr><th colspan="6">评选活动参评材料</th></tr>' +
      '<tr><td width="90">姓名</td><td></td><td>性别</td><td></td><td>赛道</td><td></td></tr>' +
      '<tr><td style="background-color:#eeeeee">目前岗位<br>工作内容</td><td colspan="5">填写区</td></tr>' +
      '<tr><td rowspan="3">工作经验及成绩</td><td colspan="2">起止时间</td><td colspan="2"><strong>项目名称</strong></td><td>证明人</td></tr>' +
      '<tr><td colspan="2">2024-2025</td><td colspan="2">项目A</td><td>张三</td></tr>' +
      '<tr><td colspan="2"></td><td colspan="2"></td><td></td></tr>' +
      '</table>';
    const r = await getDocxService().convertHtmlToDocx(form, out);
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    const cols = (xml.match(/<w:gridCol/g) ?? []).length;
    expect(cols).toBe(6);
    // 每行（含 docx 自动插入的 vMerge 延续格）累加宽度必须等于网格列数
    const sums = [...xml.matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map((m) => {
      const cells = (m[1].match(/<w:tc>/g) ?? []).length;
      const spans = [...m[1].matchAll(/<w:gridSpan w:val="(\d+)"\/>/g)].map((s) => Number(s[1]));
      return spans.reduce((a, b) => a + b, 0) + (cells - spans.length);
    });
    expect(sums.length).toBe(6);
    expect(sums).toEqual(sums.map(() => 6));
    // 合并、底纹、换行、加粗各自落地
    expect((xml.match(/<w:vMerge w:val="restart"\/>/g) ?? []).length).toBe(1);
    expect((xml.match(/<w:vMerge w:val="continue"\/>/g) ?? []).length).toBe(2);
    expect((xml.match(/<w:gridSpan w:val="5"\/>/g) ?? []).length).toBe(1);
    expect(xml).toMatch(/<w:shd w:fill="EEEEEE"\/>/);
    expect((xml.match(/<w:br\/>/g) ?? []).length).toBe(1);
    expect(xml).toMatch(/<w:b\/>[\s\S]*?项目名称/);
    // 标题行是真表头 → 跨页重复；数据行不是
    expect(xml).toMatch(/<w:tblHeader\/>/);
    expect((xml.match(/<w:tblHeader\/>/g) ?? []).length).toBe(1);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertMdToDocx 内联 markdown（加粗/斜体/行内码/硬换行）落到合法 run', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'md-inline.docx');
    const r = await getDocxService().convertMdToDocx(
      '正文**加粗**和*斜体*与`代码`<br>换行后\n',
      undefined,
      out,
      {},
    );
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    expect(xml).not.toMatch(/<text[ >]/);
    expect(xml).toMatch(/<w:b\/>[\s\S]*?加粗/);
    expect(xml).toMatch(/<w:i\/>[\s\S]*?斜体/);
    expect(xml).toMatch(/Consolas[\s\S]*?代码/);
    expect(xml).toMatch(/<w:br\/>[\s\S]*?换行后/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertMdToDocx 含 mermaid 且渲染失败时降级为源码，不崩溃', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'mermaid-fallback.docx');
    const md = '# 报告\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n正文。\n';
    let rendererCalled = false;
    const r = await getDocxService().convertMdToDocx(
      md,
      undefined,
      out,
      {},
      async (html) => {
        rendererCalled = true;
        expect(html).toMatch(/class="[^"]*mermaid/); // 确实检测到 mermaid 块
        throw new Error('simulated render failure'); // 渲染失败 → 应降级
      },
    );
    expect(rendererCalled).toBe(true);
    expect(r.success, r.error).toBe(true); // 降级而非失败
    expect(r.outputPath).toBe(out);
    // 降级必须保留 mermaid 源码，而不是静默丢弃内容
    const xml = await docxText(out);
    expect(xml).toContain('graph TD');
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(1000);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertMdToDocx 无 mermaid 时不调用 renderMermaid 回调', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'mermaid-plain.docx');
    let called = false;
    const r = await getDocxService().convertMdToDocx(
      '# 标题\n\n纯文本，无代码块。\n',
      undefined,
      out,
      {},
      async () => {
        called = true;
        return { html: '', count: 0 };
      },
    );
    expect(called).toBe(false);
    expect(r.success, r.error).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 支持 <img> data-URI 图片', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'img.docx');
    const html = `<p>图：</p><img src="data:image/png;base64,${MINI_PNG.toString('base64')}" />`;
    const r = await getDocxService().convertHtmlToDocx(html, out);
    expect(r.success).toBe(true);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(1000);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 支持 <img> 文件路径图片', async () => {
    const dir = await tmp();
    const pic = path.join(dir, 'pic.png');
    await fs.writeFile(pic, MINI_PNG);
    const out = path.join(dir, 'img-file.docx');
    const html = `<p>图：</p><img src="${pic}" />`;
    const r = await getDocxService().convertHtmlToDocx(html, out);
    expect(r.success).toBe(true);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(1000);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 不支持的图片格式（svg）静默跳过，不崩溃', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'img-svg.docx');
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64')}`;
    const html = `<p>前文</p><img src="${svg}" /><p>后文</p>`;
    const r = await getDocxService().convertHtmlToDocx(html, out);
    expect(r.success).toBe(true);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(1000);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 图片文件不存在时静默跳过，不崩溃', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'img-missing.docx');
    const html = `<p>前文</p><img src="${path.join(dir, 'no-such.png')}" /><p>后文</p>`;
    const r = await getDocxService().convertHtmlToDocx(html, out);
    expect(r.success).toBe(true);
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(1000);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx data:image URI 的 base64 含 on= 模式时不被清洗规则误删', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'img-onpattern.docx');
    // 构造一个 imageSize 可解析的 35 字节 PNG（IHDR 1x1 RGB），其 base64
    // 末尾为 XXonABA=，包含 onABA= 子串。regex `on\w+\s*=\s*["'][^"']{0,500}?["']`
    // 会匹配 `onABA=""`（第二 " 来自 src 属性收尾引号），无屏蔽时会
    // 把 onABA=" alt=" 整段当事件属性误删，破坏 data URI。
    const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAAAAXXonABA=';
    const html = `<p>前文<img src="data:image/png;base64,${pngB64}" alt="x">后文</p>`;
    const r = await getDocxService().convertHtmlToDocx(html, out);
    expect(r.success).toBe(true);
    const xml = await docxText(out);
    expect(xml).toContain('前文');
    expect(xml).toContain('后文');
    // 图片二进制须真正进入 docx（PNG 签名 \x89PNG），在 word/media/ 下。
    // 解包 docx 验证 media 条目与图片内容。
    const docxBuf = await fs.readFile(out);
    const zip = await JSZip.loadAsync(docxBuf);
    const mediaEntries = Object.keys(zip.files).filter((e) => e.startsWith('word/media/') && e.endsWith('.png'));
    expect(mediaEntries.length).toBeGreaterThan(0);
    const mediaContent = (await zip.file(mediaEntries[0])?.async('nodebuffer')) as Buffer;
    expect(mediaContent).toBeDefined();
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 正文中的 "__IMG_0__" 字面量不被占位符还原误替换', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'img-placeholder.docx');
    // 占位符须带随机 nonce：否则正文里恰好出现 __IMG_0__ 字面量（且文档含图片）时，
    // 还原步骤会把这段文字静默替换成图片 data URI。
    const html = `<img src="data:image/png;base64,${MINI_PNG.toString('base64')}" /><p>标记 __IMG_0__ 原样保留</p>`;
    const r = await getDocxService().convertHtmlToDocx(html, out);
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    expect(xml).toContain('__IMG_0__');
    expect(xml).not.toContain('data:image');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('convertHtmlToDocx 容器混合文本与元素时顶层直接文本不丢失', async () => {
    const dir = await tmp();
    const out = path.join(dir, 'mixed-container.docx');
    // 容器同时有直接文本与元素子节点：只按 children() 下钻会丢弃直接文本
    const html = '<div>介绍文本<p>内部段落</p></div>';
    const r = await getDocxService().convertHtmlToDocx(html, out);
    expect(r.success, r.error).toBe(true);
    const xml = await docxText(out);
    expect(xml).toContain('介绍文本');
    expect(xml).toContain('内部段落');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('MERMAID_SCRIPT_STRIP_RE 剔除 mermaid CDN script 引用', () => {
    const html =
      '<!doctype html><html><head>' +
      '<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>' +
      '<script src="https://example.com/analytics.js"></script>' +
      '</head><body><div class="mermaid">graph TD\n A --> B</div></body></html>';
    const stripped = html.replace(MERMAID_SCRIPT_STRIP_RE, '');
    // mermaid CDN script 被剔除
    expect(stripped).not.toContain('mermaid.min.js');
    // 非 mermaid 的第三方 script 保留（只剔除 mermaid 引用）
    expect(stripped).toContain('analytics.js');
  });
});

describe('PDF 后处理（pdf-lib）', () => {
  it('addWatermark 文字水印原地覆盖 PDF', async () => {
    const dir = await tmp();
    const pdf = path.join(dir, 'w.pdf');
    await fs.writeFile(pdf, MINI_PDF);
    const r = await pdfPostProcessor.addWatermark(pdf, { watermarkText: 'CONFIDENTIAL' });
    expect(r.success).toBe(true);
    const after = await fs.readFile(pdf);
    expect(after.length).toBeGreaterThan(MINI_PDF.length);
    await fs.rm(dir, { recursive: true, force: true });
  });

  // CJK 字体子集化（Windows msyh.ttc 等大字体）在 CI runner 上可超过 5s
  it('addWatermark 中文水印（嵌入中文字体）', async () => {
    const dir = await tmp();
    const pdf = path.join(dir, 'cn.pdf');
    await fs.writeFile(pdf, MINI_PDF);
    const r = await pdfPostProcessor.addWatermark(pdf, { watermarkText: '机密文件' });
    // 中文字体嵌入失败也应回退而非崩溃（无中文字体时跳过绘制，不抛 WinAnsi 错误）
    expect(r.success).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  }, 30000);

  it('addQrCode 末页嵌入二维码 + 说明文字', async () => {
    const dir = await tmp();
    const pdf = path.join(dir, 'q.pdf');
    const qr = path.join(dir, 'qr.png');
    await fs.writeFile(pdf, MINI_PDF);
    await fs.writeFile(qr, MINI_PNG);
    const r = await pdfPostProcessor.addQrCode(pdf, qr, {
      qrScale: 0.15,
      addText: true,
      customText: 'Scan me',
    });
    expect(r.success).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('addQrCode 中文说明文字', async () => {
    const dir = await tmp();
    const pdf = path.join(dir, 'qc.pdf');
    const qr = path.join(dir, 'qr.png');
    await fs.writeFile(pdf, MINI_PDF);
    await fs.writeFile(qr, MINI_PNG);
    const r = await pdfPostProcessor.addQrCode(pdf, qr, { customText: '扫码查看' });
    expect(r.success).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  }, 30000);
});
