import { describe, it, expect, vi } from 'vitest';

// vi.hoisted ensures the mock state is available when vi.mock's factory runs
const mockState = vi.hoisted(() => ({ failOnCall: 0, calls: 0 }));

vi.mock('./src/pdf-engine/png-encoder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./src/pdf-engine/png-encoder.js')>();
  return {
    ...actual,
    encodePng: vi.fn(async (...args: Parameters<typeof actual.encodePng>) => {
      mockState.calls++;
      if (mockState.calls === mockState.failOnCall) return null;
      return actual.encodePng(...args);
    }),
  };
});

const { parseDocument } = await import('./src/pdf-engine/pdf-engine.js');

describe('pdf-engine image encode failure', () => {
  it('keeps markdown refs and result.images in sync when an image fails', async () => {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Body', { x: 72, y: 700, size: 12, font, color: rgb(0, 0, 0) });

    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    // 3 identical 1x1 images at different positions so pdfjs extracts each separately
    const img1 = await doc.embedPng(Buffer.from(b64, 'base64'));
    page.drawImage(img1, { x: 100, y: 500, width: 40, height: 40 });
    const img2 = await doc.embedPng(Buffer.from(b64, 'base64'));
    page.drawImage(img2, { x: 200, y: 500, width: 40, height: 40 });
    const img3 = await doc.embedPng(Buffer.from(b64, 'base64'));
    page.drawImage(img3, { x: 300, y: 500, width: 40, height: 40 });

    const buf = Buffer.from(await doc.save());

    mockState.calls = 0;
    mockState.failOnCall = 2; // 2nd image fails

    const result = await parseDocument(buf, { outputFormat: 'markdown', markdown: { imageOutput: 'external' } });

    expect(result.success).toBe(true);
    // Only 2 images survive (1st and 3rd), numbered contiguously
    expect(result.images).toHaveLength(2);
    expect(result.images![0].filename).toBe('img-1.png');
    expect(result.images![1].filename).toBe('img-2.png');
    // Markdown references match exactly — no dangling img-3 or gap
    expect(result.markdown).toContain('img-1.png');
    expect(result.markdown).toContain('img-2.png');
    expect(result.markdown).not.toContain('img-3.png');
  });
});
