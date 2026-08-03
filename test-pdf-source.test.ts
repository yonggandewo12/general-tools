import { describe, it, expect } from 'vitest';
import { parsePdf } from './src/pdf-engine/pdf-source.js';
import { makeTextPdf } from './test-pdf-fixtures.js';

describe('pdf-source', () => {
  it('extracts text items with coordinates', async () => {
    const buf = await makeTextPdf([
      { text: 'Title', x: 72, yTop: 80, size: 24, bold: true },
      { text: 'Body text', x: 72, yTop: 140, size: 12 },
    ]);
    const result = await parsePdf(buf);
    expect(result.pageCount).toBe(1);
    const page = result.pages[0];
    expect(page.items.length).toBeGreaterThanOrEqual(2);
    // Title 在上方（y 更小），Body 在下方（y 更大）
    const items = [...page.items].sort((a, b) => a.y - b.y);
    expect(items[0].str).toContain('Title');
    // isBold 依赖 fontName 启发式（pdf-lib 生成的字体名可能不含 "bold"）
    // 核心验证：标题字号 > 正文字号
    expect(items[0].fontSize).toBeGreaterThan(items[1].fontSize);
    expect(page.width).toBeGreaterThan(0);
  });

  it('returns page dimensions', async () => {
    const buf = await makeTextPdf([{ text: 'X', x: 72, yTop: 100 }], 612, 792);
    const result = await parsePdf(buf);
    expect(result.pages[0].width).toBeCloseTo(612, 0);
    expect(result.pages[0].height).toBeCloseTo(792, 0);
  });

  it('handles corrupt input', async () => {
    await expect(parsePdf(Buffer.from('not a pdf'))).rejects.toThrow();
  });

  it('extracts embedded images with placement bbox', async () => {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('X', { x: 72, y: 700, size: 12, font, color: rgb(0, 0, 0) });
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const img = await doc.embedPng(Buffer.from(b64, 'base64'));
    page.drawImage(img, { x: 250, y: 500, width: 40, height: 40 });
    const buf = Buffer.from(await doc.save());

    const result = await parsePdf(buf);
    const page1 = result.pages[0];
    expect(page1.images.length).toBeGreaterThanOrEqual(1);
    const im = page1.images[0];
    expect(im.pixelWidth).toBeGreaterThan(0);
    expect(im.pixelHeight).toBeGreaterThan(0);
    expect(im.kind).toBeDefined();
    // 图片绘制在 x=250, y=[500,540]（底部原点）→ top-down y ≈ 252, x ≈ 250
    expect(im.x).toBeCloseTo(250, 0);
    expect(im.y).toBeCloseTo(252, 0);
    expect(im.width).toBeCloseTo(40, 0);
    expect(im.height).toBeCloseTo(40, 0);
  });
});
