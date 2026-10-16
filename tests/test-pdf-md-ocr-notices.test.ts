/**
 * convert_to_markdown 的退化护栏通知链测试。
 *
 * 护栏本身在 `normalizeOcrPdfResult`（见 test-ocr-quality.test.ts）；本文件验证
 * 通知能走到调用方：OCR 页 → 归一化 → ppt-master-service → 工具结果的 `warnings`。
 * `pdf-inspector-service` 被整体 mock，因此不触碰 PDFium/ONNX 原生库。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import type { OcrPdfResult } from '@firecrawl/pdf-inspector';
import { normalizeOcrPdfResult } from '../src/pdf-inspector-types.js';
import type { NormalizedPdfDocument } from '../src/pdf-inspector-types.js';
import type { ConvertToMarkdownOptions } from '../src/types.js';

const mockProcessPdfWithOcrFor = vi.fn();
const NATIVE_TEXT = 'native fallback text';

vi.mock('../src/pdf-inspector-service.js', () => ({
  extractMarkdown: async () => ({
    markdown: NATIVE_TEXT,
    pagesNeedingOcr: [0],
    pageCount: 1,
  }),
  classifyPdf: async () => ({
    pdfType: 'Scanned',
    pageCount: 1,
    pagesNeedingOcr: [0],
    confidence: 1,
  }),
  processPdfWithOcrFor: (...args: unknown[]) => mockProcessPdfWithOcrFor(...args),
}));

const { PptMasterService } = await import('../src/ppt-master-service.js');

const ZERO_PAGE = '0'.repeat(20);

/** 用真实的 `normalizeOcrPdfResult` 造文档：护栏命中须在这条链上被看到。 */
function ocrDoc(markdown: string): NormalizedPdfDocument {
  return normalizeOcrPdfResult({
    pageCount: 1,
    processingTimeMs: 1,
    isComplex: false,
    pagesRecommendedForOcr: [],
    pagesWithTables: [],
    pagesWithColumns: [],
    pages: [
      {
        pageNumber: 1,
        markdown,
        provenance: {
          source: 'Ocr',
          ocrConfidence: 0.99,
          hostedRecommended: false,
          warnings: [],
        },
      },
    ],
  } as unknown as OcrPdfResult);
}

async function convert(options: Partial<ConvertToMarkdownOptions> = {}) {
  const work = await mkdtemp(path.join(tmpdir(), 'mdocr-notices-'));
  const outputPath = path.join(work, 'out.md');
  try {
    const result = await new PptMasterService({
      checkPython: vi.fn(async () => {}),
      checkPackages: vi.fn(async () => []),
      run: vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })),
    } as never).convertToMarkdown({
      source: path.join(work, 'scan.pdf'),
      outputPath,
      sourceType: 'pdf',
      ...options,
    });
    const written = await readFile(outputPath, 'utf-8');
    return { result, written, work };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

describe('convert_to_markdown degeneracy notices', () => {
  beforeEach(() => {
    mockProcessPdfWithOcrFor.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('surfaces a degenerate OCR page in the result warnings without rewriting the artifact', async () => {
    mockProcessPdfWithOcrFor.mockResolvedValue(ocrDoc(ZERO_PAGE));

    const { result, written } = await convert({ pdfOcr: 'force' });

    expect(result.success, result.error).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatch(/look incomplete after local OCR \(1-indexed: 1\)/);
    // 产物只含识别文本：通知走结构化字段，不注入 markdown
    expect(written).toBe(ZERO_PAGE);
  });

  it('stays silent on a healthy OCR page', async () => {
    mockProcessPdfWithOcrFor.mockResolvedValue(ocrDoc('领奖人：徐亮 单位：技术研发部'));

    const { result } = await convert({ pdfOcr: 'force' });

    expect(result.warnings).toBeUndefined();
  });

  it('reports the OCR-runtime fallback as a warning on the auto path', async () => {
    mockProcessPdfWithOcrFor.mockRejectedValue(
      new Error('process_pdf_with_ocr: failed to load ONNX Runtime shared library'),
    );

    const { result, written } = await convert({ pdfOcr: 'auto' });

    expect(result.success, result.error).toBe(true);
    expect(result.warnings![0]).toMatch(/Local OCR unavailable .*scanned-page text may be incomplete/);
    expect(written).toBe(NATIVE_TEXT);
  });

  it('merges notices with unimplemented-option warnings', async () => {
    mockProcessPdfWithOcrFor.mockResolvedValue(ocrDoc(ZERO_PAGE));

    const { result } = await convert({ pdfOcr: 'force', renderVectorFigures: true });

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings![0]).toMatch(/renderVectorFigures/);
    expect(result.warnings![1]).toMatch(/look incomplete after local OCR/);
  });
});
