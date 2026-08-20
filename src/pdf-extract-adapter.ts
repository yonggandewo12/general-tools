/**
 * Adapter: align NAPI-extracted NormalizedPdfDocument with the public MCP
 * `extract_pdf_text` tool's three-mode output contract (text | json | markdown).
 *
 * - `text`: per-page markdown joined with `--- Page Break ---` separators.
 * - `json`: full NormalizedPdfDocument serialized (includes textItems).
 * - `markdown`: per-page markdown joined with paragraph breaks.
 *
 * Page selection: input is `string` (`"1-5,10"`) 1-indexed.
 * Conversion to 0-indexed happens here; service receives 0-indexed.
 *
 * `maxPages` caps the number of pages extracted (default
 * `DEFAULT_MAX_PAGES`). When `targetPages` is also given, the parsed list is
 * truncated to the first `maxPages` entries. Without `targetPages`, the cap
 * is delegated to the service, which validates it against the real page
 * count (the NAPI silently returns empty phantom pages for out-of-range
 * page numbers).
 */
import type { PdfExtractOptions, PdfExtractResult, PdfOutputFormat } from './types.js';
import * as pdfInspector from './pdf-inspector-service.js';
import { PdfInspectorError } from './pdf-inspector-service.js';

/** Default cap on extracted pages, matching the tool description. */
const DEFAULT_MAX_PAGES = 1000;

/** Upper bound on expanded page selections, to prevent OOM on ranges like "1-999999999". */
const MAX_SELECTABLE_PAGES = 100_000;

/**
 * Parse a page range string like `"1-5,10,15-20"` into a 1-indexed sorted array.
 * Returns `undefined` when `spec` is empty/undefined (whole document).
 *
 * Rejects non-integer tokens (e.g. `1e3`, `5.0`, `0x10`) by requiring the
 * raw string to consist solely of decimal digits, and rejects selections
 * that would expand to more than `MAX_SELECTABLE_PAGES` entries.
 */
export function parsePages(spec: string | undefined): number[] | undefined {
  if (!spec) return undefined;
  const pages: number[] = [];
  const seen = new Set<number>();
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) throw new Error(`Invalid page range: "${spec}"`);
    if (trimmed.includes('-')) {
      const dash = trimmed.indexOf('-');
      const startRaw = trimmed.slice(0, dash).trim();
      const endRaw = trimmed.slice(dash + 1).trim();
      if (!isPositiveInt(startRaw) || !isPositiveInt(endRaw)) {
        throw new Error(`Invalid page range: "${spec}"`);
      }
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (start > end) throw new Error(`Invalid page range (start > end): "${spec}"`);
      if (pages.length + (end - start + 1) > MAX_SELECTABLE_PAGES) {
        throw new Error(
          `Invalid page range: "${spec}" selects more than ${MAX_SELECTABLE_PAGES} pages`,
        );
      }
      for (let i = start; i <= end; i++) {
        if (!seen.has(i)) {
          seen.add(i);
          pages.push(i);
        }
      }
    } else {
      if (!isPositiveInt(trimmed)) throw new Error(`Invalid page range: "${spec}"`);
      const n = Number(trimmed);
      if (!seen.has(n)) {
        seen.add(n);
        pages.push(n);
      }
    }
  }
  return pages;
}

function isPositiveInt(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  return n >= 1 && Number.isSafeInteger(n);
}

/** Normalize `maxPages`: invalid values (< 1, non-finite) fall back to the default. */
function resolveMaxPages(maxPages?: number): number {
  if (maxPages === undefined || !Number.isFinite(maxPages) || maxPages < 1) {
    return DEFAULT_MAX_PAGES;
  }
  return Math.floor(maxPages);
}

export async function extractPdf(
  options: PdfExtractOptions,
): Promise<PdfExtractResult> {
  const start = Date.now();
  const format: PdfOutputFormat = options.outputFormat ?? 'text';
  try {
    const parsed = parsePages(options.targetPages);
    const zeroIndexed = parsed?.map((p) => p - 1);
    const maxPages = resolveMaxPages(options.maxPages);

    // With an explicit selection, truncate to the first maxPages entries.
    // Without one, pass maxPages through — the service validates it against
    // the real page count and never requests out-of-range pages.
    const pages = zeroIndexed?.slice(0, maxPages);

    if (format === 'text') {
      const doc = await pdfInspector.extractPages(options.pdfPath, {
        pages,
        password: options.password,
        maxPages,
      });
      const pageTexts = doc.pages.map((p) => {
        const parts: string[] = [`[Page ${p.pageIndex + 1}]`];
        if (p.needsOcr) {
          parts.push(`(Page ${p.pageIndex + 1} flagged for OCR — text content may be unreliable)`);
        }
        if (p.markdown) {
          parts.push(p.markdown);
        }
        return parts.join('\n\n');
      });
      return {
        success: true,
        text: pageTexts.join('\n\n--- Page Break ---\n\n').trim(),
        pageCount: doc.pageCount,
        details: { processingTime: Date.now() - start },
      };
    }

    if (format === 'json') {
      const doc = await pdfInspector.extractPages(options.pdfPath, {
        pages,
        password: options.password,
        maxPages,
        includeTextItems: true,
      });
      return {
        success: true,
        text: JSON.stringify(doc, null, 2),
        pageCount: doc.pageCount,
        details: { processingTime: Date.now() - start },
      };
    }

    // markdown
    const { markdown, pagesNeedingOcr, pageCount } = await pdfInspector.extractMarkdown(
      options.pdfPath,
      { pages, password: options.password, maxPages },
    );
    const prefix =
      pagesNeedingOcr.length > 0
        ? `<!-- OCR warning: ${pagesNeedingOcr.length} page(s) [${pagesNeedingOcr
            .map((p) => p + 1)
            .join(', ')}] flagged for OCR; native text may be incomplete. -->\n\n`
        : '';
    return {
      success: true,
      text: prefix + markdown,
      pageCount,
      details: { processingTime: Date.now() - start },
    };
  } catch (err) {
    if (err instanceof PdfInspectorError) {
      return {
        success: false,
        error: `${err.code}: ${err.message}`,
        details: {
          processingTime: Date.now() - start,
        },
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      details: { processingTime: Date.now() - start },
    };
  }
}
