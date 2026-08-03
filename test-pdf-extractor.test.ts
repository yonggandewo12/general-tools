import { describe, it, expect } from 'vitest';
import { PdfExtractor } from './src/pdf-extractor.js';
import { makeTextPdf, writeFixture } from './test-pdf-fixtures.js';

describe('PdfExtractor.extract (new engine)', () => {
  it('extracts markdown with heading structure', async () => {
    const buf = await makeTextPdf([
      { text: 'Chapter One', x: 72, yTop: 80, size: 22, bold: true },
      { text: 'Some body text.', x: 72, yTop: 130 },
    ]);
    const pdfPath = await writeFixture('extract.md.pdf', buf);
    const result = await new PdfExtractor().extract({ pdfPath, outputFormat: 'markdown' });
    expect(result.success).toBe(true);
    expect(result.text).toContain('# Chapter One');
    expect(result.text).toContain('Some body text.');
  });

  it('returns text output by default', async () => {
    const buf = await makeTextPdf([{ text: 'Hello extract', x: 72, yTop: 100 }]);
    const pdfPath = await writeFixture('extract.txt.pdf', buf);
    const result = await new PdfExtractor().extract({ pdfPath });
    expect(result.success).toBe(true);
    expect(result.text).toContain('Hello extract');
    expect(result.pageCount).toBe(1);
  });

  it('rejects malformed targetPages', async () => {
    const buf = await makeTextPdf([{ text: 'Hello extract', x: 72, yTop: 100 }]);
    const pdfPath = await writeFixture('extract.badpages.pdf', buf);
    const result = await new PdfExtractor().extract({ pdfPath, targetPages: 'abc' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid page range');
  });
});
