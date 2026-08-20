/**
 * Unit tests for pdf-extract-adapter.
 * Mocks @firecrawl/pdf-inspector-service to verify adapter contract.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockExtractPages = vi.fn();
const mockExtractMarkdown = vi.fn();

vi.mock('../src/pdf-inspector-service.js', async () => {
  const actual = await vi.importActual<typeof import('../src/pdf-inspector-service.js')>(
    '../src/pdf-inspector-service.js',
  );
  return {
    ...actual,
    extractPages: (...args: unknown[]) => mockExtractPages(...args),
    extractMarkdown: (...args: unknown[]) => mockExtractMarkdown(...args),
  };
});

import { extractPdf } from '../src/pdf-extract-adapter.js';

beforeEach(() => {
  mockExtractPages.mockReset();
  mockExtractMarkdown.mockReset();
});

describe('extractPdf', () => {
  it('text format joins pages with separators', async () => {
    mockExtractPages.mockResolvedValue({
      pageCount: 2,
      pages: [
        { pageIndex: 0, markdown: 'Hello world', needsOcr: false, textItems: [] },
        { pageIndex: 1, markdown: 'Page two', needsOcr: false, textItems: [] },
      ],
      pagesNeedingOcr: [],
    });
    const result = await extractPdf({
      pdfPath: '/tmp/x.pdf',
      outputFormat: 'text',
    });
    expect(result.success).toBe(true);
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain('[Page 1]');
    expect(result.text).toContain('Hello world');
    expect(result.text).toContain('--- Page Break ---');
    expect(result.text).toContain('Page two');
  });

  it('text format does not append trailing page-break separator', async () => {
    mockExtractPages.mockResolvedValue({
      pageCount: 2,
      pages: [
        { pageIndex: 0, markdown: 'A', needsOcr: false, textItems: [] },
        { pageIndex: 1, markdown: 'B', needsOcr: false, textItems: [] },
      ],
      pagesNeedingOcr: [],
    });
    const result = await extractPdf({ pdfPath: '/tmp/x.pdf', outputFormat: 'text' });
    expect(result.success).toBe(true);
    expect(result.text!.endsWith('--- Page Break ---')).toBe(false);
    expect(result.text!.endsWith('B')).toBe(true);
  });

  it('text format flags pages needing OCR', async () => {
    mockExtractPages.mockResolvedValue({
      pageCount: 1,
      pages: [
        { pageIndex: 0, markdown: '', needsOcr: true, textItems: [] },
      ],
      pagesNeedingOcr: [0],
    });
    const result = await extractPdf({
      pdfPath: '/tmp/x.pdf',
      outputFormat: 'text',
    });
    expect(result.success).toBe(true);
    expect(result.text).toContain('flagged for OCR');
  });

  it('json format requests includeTextItems and serializes full document', async () => {
    const doc = {
      pageCount: 1,
      pdfType: 'TextBased',
      pages: [{ pageIndex: 0, markdown: 'x', needsOcr: false, textItems: [{ page: 1 }] }],
      pagesNeedingOcr: [],
      pagesWithTables: [],
      pagesWithColumns: [],
    };
    mockExtractPages.mockResolvedValue(doc);
    const result = await extractPdf({
      pdfPath: '/tmp/x.pdf',
      outputFormat: 'json',
    });
    expect(result.success).toBe(true);
    expect(mockExtractPages).toHaveBeenCalledWith('/tmp/x.pdf', expect.objectContaining({ includeTextItems: true }));
    expect(JSON.parse(result.text!)).toEqual(doc);
  });

  it('markdown format joins pages and returns pageCount', async () => {
    mockExtractMarkdown.mockResolvedValue({
      markdown: '# A\n\ntext\n\n# B\n\nmore',
      pagesNeedingOcr: [],
      pageCount: 3,
    });
    const result = await extractPdf({
      pdfPath: '/tmp/x.pdf',
      outputFormat: 'markdown',
    });
    expect(result.success).toBe(true);
    expect(result.text).toBe('# A\n\ntext\n\n# B\n\nmore');
    expect(result.pageCount).toBe(3);
  });

  it('markdown format prepends OCR warning when pages need OCR', async () => {
    mockExtractMarkdown.mockResolvedValue({
      markdown: 'content',
      pagesNeedingOcr: [1, 3],
      pageCount: 5,
    });
    const result = await extractPdf({
      pdfPath: '/tmp/x.pdf',
      outputFormat: 'markdown',
    });
    expect(result.success).toBe(true);
    expect(result.text).toMatch(/^<!-- OCR warning/);
    expect(result.text).toContain('[2, 4]');
    expect(result.text).toContain('content');
  });

  it('converts 1-indexed targetPages to 0-indexed for service', async () => {
    mockExtractPages.mockResolvedValue({ pageCount: 1, pages: [], pagesNeedingOcr: [] });
    await extractPdf({ pdfPath: '/tmp/x.pdf', outputFormat: 'text', targetPages: '1-3,5' });
    expect(mockExtractPages).toHaveBeenCalledWith('/tmp/x.pdf', {
      pages: [0, 1, 2, 4],
      password: undefined,
      maxPages: 1000,
    });
  });

  it('passes password through to service', async () => {
    mockExtractPages.mockResolvedValue({ pageCount: 1, pages: [], pagesNeedingOcr: [] });
    await extractPdf({ pdfPath: '/tmp/x.pdf', outputFormat: 'text', password: 'secret' });
    expect(mockExtractPages).toHaveBeenCalledWith('/tmp/x.pdf', {
      pages: undefined,
      password: 'secret',
      maxPages: 1000,
    });
  });

  it('maxPages truncates targetPages selection', async () => {
    mockExtractPages.mockResolvedValue({ pageCount: 2, pages: [], pagesNeedingOcr: [] });
    await extractPdf({
      pdfPath: '/tmp/x.pdf',
      outputFormat: 'text',
      targetPages: '1-10',
      maxPages: 3,
    });
    expect(mockExtractPages).toHaveBeenCalledWith('/tmp/x.pdf', {
      pages: [0, 1, 2],
      password: undefined,
      maxPages: 3,
    });
  });

  it('maxPages without targetPages is delegated to the service (no blind page list)', async () => {
    mockExtractPages.mockResolvedValue({ pageCount: 5, pages: [], pagesNeedingOcr: [] });
    await extractPdf({
      pdfPath: '/tmp/x.pdf',
      outputFormat: 'text',
      maxPages: 5,
    });
    // The service validates maxPages against the real page count; the adapter
    // must not build [0..maxPages-1] itself (out-of-range pages would produce
    // empty phantom pages in the NAPI).
    expect(mockExtractPages).toHaveBeenCalledWith('/tmp/x.pdf', {
      pages: undefined,
      password: undefined,
      maxPages: 5,
    });
  });

  it('applies the default maxPages of 1000 when unspecified', async () => {
    mockExtractPages.mockResolvedValue({ pageCount: 1, pages: [], pagesNeedingOcr: [] });
    await extractPdf({ pdfPath: '/tmp/x.pdf', outputFormat: 'text' });
    expect(mockExtractPages).toHaveBeenCalledWith('/tmp/x.pdf', {
      pages: undefined,
      password: undefined,
      maxPages: 1000,
    });
  });

  it('invalid maxPages falls back to the default', async () => {
    mockExtractPages.mockResolvedValue({ pageCount: 1, pages: [], pagesNeedingOcr: [] });
    await extractPdf({ pdfPath: '/tmp/x.pdf', outputFormat: 'text', maxPages: 0 });
    expect(mockExtractPages).toHaveBeenCalledWith('/tmp/x.pdf', {
      pages: undefined,
      password: undefined,
      maxPages: 1000,
    });
    await extractPdf({ pdfPath: '/tmp/x.pdf', outputFormat: 'text', maxPages: -3 });
    expect(mockExtractPages).toHaveBeenLastCalledWith('/tmp/x.pdf', {
      pages: undefined,
      password: undefined,
      maxPages: 1000,
    });
  });

  it('catches PdfInspectorError and returns structured failure', async () => {
    const { PdfInspectorError } = await import('../src/pdf-inspector-service.js');
    mockExtractPages.mockRejectedValue(
      new PdfInspectorError('BAD_PDF', 'Invalid PDF header'),
    );
    const result = await extractPdf({ pdfPath: '/tmp/x.pdf', outputFormat: 'text' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('BAD_PDF');
    expect(result.error).toContain('Invalid PDF header');
  });

  it('catches unknown errors as stringified messages', async () => {
    mockExtractPages.mockRejectedValue(new Error('boom'));
    const result = await extractPdf({ pdfPath: '/tmp/x.pdf', outputFormat: 'text' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('invalid targetPages throws a parse error', async () => {
    const result = await extractPdf({ pdfPath: '/tmp/x.pdf', outputFormat: 'text', targetPages: 'abc' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid page range/);
  });
});
