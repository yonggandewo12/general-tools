import { describe, it, expect } from 'vitest';
import { parseDocument } from './src/pdf-engine/pdf-engine.js';
import { makeTextPdf } from './test-pdf-fixtures.js';

describe('pdf-engine facade', () => {
  it('parses a text PDF into markdown output', async () => {
    const buf = await makeTextPdf([
      { text: 'Document Title', x: 72, yTop: 80, size: 24, bold: true },
      { text: 'First paragraph here.', x: 72, yTop: 140 },
    ]);
    const result = await parseDocument(buf, { outputFormat: 'markdown' });
    expect(result.success).toBe(true);
    expect(result.markdown).toContain('# Document Title');
    expect(result.markdown).toContain('First paragraph here.');
  });

  it('returns plain text when outputFormat is text', async () => {
    const buf = await makeTextPdf([{ text: 'Just text', x: 72, yTop: 100 }]);
    const result = await parseDocument(buf, { outputFormat: 'text' });
    expect(result.success).toBe(true);
    expect(result.text).toContain('Just text');
  });

  it('returns structured json when outputFormat is json', async () => {
    const buf = await makeTextPdf([{ text: 'A heading', x: 72, yTop: 80, size: 20, bold: true }]);
    const result = await parseDocument(buf, { outputFormat: 'json' });
    expect(result.success).toBe(true);
    expect(result.json).toBeDefined();
    expect(result.json!.pages[0].blocks.length).toBeGreaterThan(0);
  });

  it('returns success:false for corrupt input', async () => {
    const result = await parseDocument(Buffer.from('not a pdf'), { outputFormat: 'text' });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('emits image references and encoded PNG assets for markdown', async () => {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Body', { x: 72, y: 700, size: 12, font, color: rgb(0, 0, 0) });
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const img = await doc.embedPng(Buffer.from(b64, 'base64'));
    page.drawImage(img, { x: 250, y: 500, width: 40, height: 40 });
    const buf = Buffer.from(await doc.save());

    const result = await parseDocument(buf, { outputFormat: 'markdown', markdown: { imageOutput: 'external', imageBasePath: 'a' } });
    expect(result.success).toBe(true);
    expect(result.markdown).toContain('![image](a/img-1.png)');
    expect(result.images).toBeDefined();
    expect(result.images!.length).toBe(1);
    // PNG 魔数
    expect(Array.from(result.images![0].data.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('pageCount reflects actually parsed pages, not total', async () => {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 3; i++) {
      const p = doc.addPage([612, 792]);
      p.drawText(`Page ${i + 1}`, { x: 72, y: 700, size: 12, font, color: rgb(0, 0, 0) });
    }
    const buf = Buffer.from(await doc.save());
    const full = await parseDocument(buf, { outputFormat: 'text' });
    const subset = await parseDocument(buf, { outputFormat: 'text', targetPages: [3] });
    expect(full.pageCount).toBe(3);
    expect(subset.pageCount).toBe(1);
    expect(subset.text).toContain('Page 3');
  });
});
