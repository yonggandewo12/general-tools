/**
 * DOCX 生成/编辑 + PDF 水印/二维码 单元测试。
 * DOCX 生成（docx npm 包）与 PDF 后处理（pdf-lib）为纯 JS，直接可测。
 * DOCX 编辑走 python-docx 子进程，依赖嵌入运行时（PPT_MASTER_PYTHON 可指定）。
 */
import { describe, expect, it } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { getDocxService } from '../src/docx-service.js';
import { pdfPostProcessor } from '../src/pdf-postprocess.js';

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

  it('addWatermark 中文水印（嵌入中文字体）', async () => {
    const dir = await tmp();
    const pdf = path.join(dir, 'cn.pdf');
    await fs.writeFile(pdf, MINI_PDF);
    const r = await pdfPostProcessor.addWatermark(pdf, { watermarkText: '机密文件' });
    // 中文字体嵌入失败也应回退而非崩溃
    expect(r.success).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

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
  });
});
