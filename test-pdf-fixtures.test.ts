import { describe, it, expect } from 'vitest';
import { makeTextPdf } from './test-pdf-fixtures.js';
import { PDFDocument } from 'pdf-lib';

describe('fixtures', () => {
  it('generates a valid PDF', async () => {
    const buf = await makeTextPdf([{ text: 'Hello', x: 72, yTop: 100 }]);
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(1);
  });
});
