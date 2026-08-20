/**
 * E2E tests for pdf-inspector-service against real PDF fixtures.
 *
 * Reads from the sibling `pdf-inspector/` repo's tests/fixtures/ directory.
 * Skips silently if the directory is not present (e.g. CI without the cloned repo).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import * as path from 'path';
import {
  extractPages,
  extractText,
  extractJson,
  extractMarkdown,
  classifyPdf,
  PdfInspectorError,
} from '../src/pdf-inspector-service.js';

const FIXTURES_DIR = path.resolve(
  import.meta.dirname,
  '..',
  'pdf-inspector/tests/fixtures',
);

/**
 * Check fixture availability at module load time.
 * Vitest's `describe.runIf` evaluates eagerly, so we must resolve
 * synchronously before the describe block runs.
 */
const fixturesAvailable = existsSync(FIXTURES_DIR);

function readFirstMatching(prefix: string): string | null {
  try {
    const files = readdirSync(FIXTURES_DIR);
    const match = files.find((f) => f.startsWith(prefix) && f.endsWith('.pdf'));
    return match ? path.join(FIXTURES_DIR, match) : null;
  } catch {
    return null;
  }
}

describe.runIf(fixturesAvailable)('pdf-inspector-service E2E (real PDF fixtures)', () => {
  it('extractPages returns per-page markdown + textItems', async () => {
    const fixture = readFirstMatching('greencomp_competence');
    expect(fixture).not.toBeNull();
    const doc = await extractPages(fixture!);
    expect(doc.pageCount).toBeGreaterThan(0);
    expect(doc.pages.length).toBe(doc.pageCount);
    expect(doc.pages[0].pageIndex).toBe(0);
    expect(typeof doc.pages[0].markdown).toBe('string');
  });

  it('extractText joins pages with markers', async () => {
    const fixture = readFirstMatching('greencomp_competence');
    expect(fixture).not.toBeNull();
    const text = await extractText(fixture!);
    expect(text).toContain('[Page 1]');
    const doc = await extractPages(fixture!);
    if (doc.pageCount > 1) {
      expect(text).toContain('--- Page Break ---');
    }
  });

  it('extractJson returns serializable document with textItems', async () => {
    const fixture = readFirstMatching('greencomp_competence');
    expect(fixture).not.toBeNull();
    const doc = await extractJson(fixture!);
    expect(Array.isArray(doc.pagesNeedingOcr)).toBe(true);
    expect(Array.isArray(doc.pagesWithTables)).toBe(true);
    expect(typeof doc.pdfType).toBe('string');
    expect(Array.isArray(doc.pages[0].textItems)).toBe(true);
  });

  it('extractMarkdown returns single string + pageCount + pagesNeedingOcr', async () => {
    const fixture = readFirstMatching('greencomp_competence');
    expect(fixture).not.toBeNull();
    const { markdown, pagesNeedingOcr, pageCount } = await extractMarkdown(fixture!);
    expect(typeof markdown).toBe('string');
    expect(Array.isArray(pagesNeedingOcr)).toBe(true);
    expect(pageCount).toBeGreaterThan(0);
  });

  it('classifyPdf returns pdfType, pageCount, and 0-indexed pagesNeedingOcr', async () => {
    const fixture = readFirstMatching('greencomp_competence');
    expect(fixture).not.toBeNull();
    const result = await classifyPdf(fixture!);
    expect(result.pageCount).toBeGreaterThan(0);
    expect(['TextBased', 'Scanned', 'ImageBased', 'Mixed']).toContain(result.pdfType);
    for (const p of result.pagesNeedingOcr) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(result.pageCount);
    }
  });

  it('classifyPdf pagesNeedingOcr is 0-indexed (not off-by-one)', async () => {
    const fixture = readFirstMatching('scan_with_native_header_text'); // 1 page, needs OCR
    expect(fixture).not.toBeNull();
    const result = await classifyPdf(fixture!);
    expect(result.pageCount).toBe(1);
    expect(result.pdfType).toBe('ImageBased');
    expect(result.pagesNeedingOcr).toEqual([0]); // 1-indexed would report [1]
  });

  it('handles broken PDF (broken_startxref_pointer) — either recovers or throws PdfInspectorError', async () => {
    const fixture = readFirstMatching('broken_startxref_pointer');
    expect(fixture).not.toBeNull();
    try {
      const doc = await extractPages(fixture!);
      expect(doc.pages).toBeDefined();
      expect(doc.pageCount).toBeGreaterThanOrEqual(0);
    } catch (err) {
      expect(err).toBeInstanceOf(PdfInspectorError);
    }
  });

  it('handles encrypted PDF with correct password', async () => {
    const fixture = readFirstMatching('encrypted-secret');
    expect(fixture).not.toBeNull();
    const doc = await extractPages(fixture!, { password: 'secret123' });
    expect(doc.pageCount).toBeGreaterThan(0);
    expect(doc.pages.length).toBeGreaterThan(0);
  });

  it('rejects encrypted PDF with wrong password', async () => {
    const fixture = readFirstMatching('encrypted-secret');
    expect(fixture).not.toBeNull();
    await expect(extractPages(fixture!, { password: 'wrong-password' })).rejects.toBeInstanceOf(
      PdfInspectorError,
    );
  });

  it('encrypted PDF json format degrades textItems gracefully', async () => {
    const fixture = readFirstMatching('encrypted-secret');
    expect(fixture).not.toBeNull();
    const doc = await extractPages(fixture!, {
      password: 'secret123',
      includeTextItems: true,
    });
    expect(doc.pageCount).toBeGreaterThan(0);
    expect(doc.pages.length).toBeGreaterThan(0);
    expect(Array.isArray(doc.pages[0].textItems)).toBe(true);
  });

  it('handles multi-column layout (no_rects)', async () => {
    const fixture = readFirstMatching('wireless_two_col_no_rects');
    expect(fixture).not.toBeNull();
    const doc = await extractPages(fixture!);
    expect(doc.pageCount).toBeGreaterThan(0);
    expect(doc.pages[0].markdown.length).toBeGreaterThan(0);
  });

  it('detects tables in forecast_table_chart', async () => {
    const fixture = readFirstMatching('forecast_table_chart');
    expect(fixture).not.toBeNull();
    const doc = await extractPages(fixture!);
    const hasTableIndicator =
      doc.pagesWithTables.length > 0 ||
      doc.pages.some((p) => p.markdown.includes('|'));
    expect(hasTableIndicator).toBe(true);
  });

  it('targetPages selection on multi-page doc returns requested pages only', async () => {
    const fixture = readFirstMatching('td9264'); // 10 pages
    expect(fixture).not.toBeNull();
    const doc = await extractPages(fixture!, { pages: [0, 2] });
    expect(doc.pages.length).toBe(2);
    expect(doc.pages[0].pageIndex).toBe(0);
    expect(doc.pages[1].pageIndex).toBe(2);
    // pageCount reflects returned page count when pages are selected
    expect(doc.pageCount).toBe(2);
  });

  it('filters out-of-range page selection (no phantom pages)', async () => {
    const fixture = readFirstMatching('greencomp_competence'); // 1 page
    expect(fixture).not.toBeNull();
    // The NAPI would silently return an empty phantom page for index 2.
    const doc = await extractPages(fixture!, { pages: [0, 2] });
    expect(doc.pages.length).toBe(1);
    expect(doc.pages[0].pageIndex).toBe(0);
    expect(doc.pageCount).toBe(1);
  });

  it('rejects an entirely out-of-range page selection with PAGE_RANGE', async () => {
    const fixture = readFirstMatching('greencomp_competence'); // 1 page
    expect(fixture).not.toBeNull();
    await expect(extractPages(fixture!, { pages: [5, 9] })).rejects.toMatchObject({
      code: 'PAGE_RANGE',
    });
  });

  it('maxPages larger than the document returns all pages without phantoms', async () => {
    const fixture = readFirstMatching('greencomp_competence'); // 1 page
    expect(fixture).not.toBeNull();
    const doc = await extractPages(fixture!, { maxPages: 5 });
    expect(doc.pages.length).toBe(1);
    expect(doc.pageCount).toBe(1);
    expect(doc.pages[0].markdown.length).toBeGreaterThan(0);
  });

  it('maxPages caps a multi-page document', async () => {
    const fixture = readFirstMatching('td9264'); // 10 pages
    expect(fixture).not.toBeNull();
    const doc = await extractPages(fixture!, { maxPages: 3 });
    expect(doc.pages.length).toBe(3);
    expect(doc.pages.map((p) => p.pageIndex)).toEqual([0, 1, 2]);
  });

  it('populates pdfType/confidence when the page-count pre-check runs', async () => {
    const fixture = readFirstMatching('greencomp_competence');
    expect(fixture).not.toBeNull();
    const doc = await extractPages(fixture!, { maxPages: 100 });
    expect(doc.pdfType).not.toBe('Unknown');
    expect(doc.confidence).toBeGreaterThan(0);
  });

  it('rejects out-of-range pages on encrypted PDFs with PAGE_RANGE', async () => {
    const fixture = readFirstMatching('encrypted-secret');
    expect(fixture).not.toBeNull();
    await expect(
      extractPages(fixture!, { password: 'secret123', pages: [0, 50] }),
    ).rejects.toMatchObject({ code: 'PAGE_RANGE' });
  });

  it('includeTextItems=false skips textItems (default)', async () => {
    const fixture = readFirstMatching('greencomp_competence');
    expect(fixture).not.toBeNull();
    const doc = await extractPages(fixture!);
    expect(doc.pages[0].textItems).toEqual([]);
  });

  it('includeTextItems=true populates textItems', async () => {
    const fixture = readFirstMatching('greencomp_competence');
    expect(fixture).not.toBeNull();
    const doc = await extractPages(fixture!, { includeTextItems: true });
    expect(doc.pages[0].textItems.length).toBeGreaterThan(0);
  });
});
