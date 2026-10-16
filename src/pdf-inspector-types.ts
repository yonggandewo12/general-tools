/**
 * @firecrawl/pdf-inspector NAPI 类型映射与内部标准化。
 *
 * 对外统一为 0-indexed；内部按 NAPI 各字段约定透传。
 *
 * `pageCount` 语义：
 * - 走 `extractPagesMarkdownAsync` 路径时，NAPI 不返回总页数，
 *   `pageCount` 取 `pages.length`（未选页时即总页数；选页时为返回页数）。
 * - 走 `processPdfWithOcr` 路径时，NAPI 返回真实总页数，直接采用。
 */
import type {
  PagesExtractionResult,
  TextItem,
  OcrPdfResult,
  PageOcrReasons,
  StructureElementJs,
} from '@firecrawl/pdf-inspector';
import { detectDegeneracy } from './ocr-quality.js';

// 注意：本文件只允许 type-only import/re-export。任何值导出（如
// `export { OcrMode } from ...`）都会在模块加载阶段触发原生二进制
// require，导致无 prebuilt 二进制的平台（macOS x86_64）在启动时崩溃。
// `./ocr-quality.js` 为纯 JS 模块，不引入原生依赖，是此规则的唯一例外值导入。

export type {
  TextItem,
  PageOcrReasons,
  StructureElementJs,
};

/** pdfType fallback when the underlying NAPI result has no pdfType field. */
export const UNKNOWN_PDF_TYPE = 'Unknown';

/** 标准化后的 PDF 文档。**所有页码字段统一 0-indexed。** */
export interface NormalizedPdfDocument {
  /** 返回的页数（未选页时等于文档总页数；选页时为实际返回的页数）。 */
  pageCount: number;
  pdfType: string;
  pages: NormalizedPage[];
  /** 0-indexed */
  pagesNeedingOcr: number[];
  /** 0-indexed */
  pagesWithTables: number[];
  /** 0-indexed */
  pagesWithColumns: number[];
  processingTimeMs: number;
  isComplexLayout: boolean;
  hasEncodingIssues: boolean;
  title?: string;
  confidence: number;
}

export interface NormalizedPage {
  /** 0-indexed */
  pageIndex: number;
  markdown: string;
  needsOcr: boolean;
  ocrReason?: string;
  textItems: TextItem[];
  /**
   * OCR 路径（processPdfWithOcr）填充：该页内容来源与质量信息。
   * native 提取路径（extractPagesMarkdownAsync）为 undefined。
   */
  ocrProvenance?: NormalizedOcrProvenance;
}

/** 单页 OCR 来源与质量摘要（0-indexed 语义无关，仅透传 NAPI 字段）。 */
export interface NormalizedOcrProvenance {
  /** 页面内容来源：Native=原生文本，Ocr=本地 OCR，Fused=两者融合。 */
  source: 'Native' | 'Ocr' | 'Fused';
  /** OCR 置信度（0-1），仅 Ocr/Fused 页存在。 */
  ocrConfidence?: number;
  /** OCR 完成后仍空/低置信/疑似不完整，建议改用其他解析途径。退化护栏命中时同样置真。 */
  hostedRecommended: boolean;
  /** 引擎给出的告警，加上本地退化护栏追加的告警（见 `ocr-quality.ts`）。 */
  warnings: string[];
}

/** Group 1-indexed TextItems into a 0-indexed page → items map. */
function groupTextItemsByPage(textItems: TextItem[]): Map<number, TextItem[]> {
  const byPage = new Map<number, TextItem[]>();
  for (const item of textItems) {
    const idx = item.page - 1;
    const list = byPage.get(idx) ?? [];
    list.push(item);
    byPage.set(idx, list);
  }
  return byPage;
}

/**
 * Normalize `PagesExtractionResult` (from `extractPagesMarkdownAsync`) to
 * 0-indexed `NormalizedPdfDocument`.
 *
 * NAPI 侧 `pagesNeedingOcr` / `pagesWithTables` / `pagesWithColumns` 均为
 * 1-indexed，此处统一转 0-indexed。
 *
 * `classification`（可选）来自 `classifyPdfAsync` 的预检结果，用于填充
 * `pdfType` / `confidence`；未预检时回落到 `Unknown` / 0。
 */
export function normalizePagesExtraction(
  raw: PagesExtractionResult,
  textItems: TextItem[],
  classification?: { pdfType: string; confidence: number },
): NormalizedPdfDocument {
  const itemsByPage = groupTextItemsByPage(textItems);

  const pages: NormalizedPage[] = raw.pages.map((p) => ({
    pageIndex: p.page,
    markdown: p.markdown,
    needsOcr: p.needsOcr,
    ocrReason: p.ocrReason,
    textItems: itemsByPage.get(p.page) ?? [],
  }));

  return {
    pageCount: pages.length,
    pdfType: classification?.pdfType ?? UNKNOWN_PDF_TYPE,
    pages,
    pagesNeedingOcr: raw.pagesNeedingOcr.map((p) => p - 1),
    pagesWithTables: raw.pagesWithTables.map((p) => p - 1),
    pagesWithColumns: raw.pagesWithColumns.map((p) => p - 1),
    processingTimeMs: 0,
    isComplexLayout: raw.isComplex,
    hasEncodingIssues: false,
    confidence: classification?.confidence ?? 0,
  };
}

/**
 * 引擎自身就"该页没有可用文本"给出的告警文案特征。实测（apple silicon ONNX
 * 后端）空页返回 `warnings: ['OCR produced no usable text']`、`markdown: ''`，
 * 护栏据此去重，避免同一事实出现两条文案。全零/单字符支配两种签名引擎**不会**
 * 报告；引擎另一条 `'<N> OCR spans with unusable text or geometry'` 说的是"部分
 * 文本块被丢弃"，与"整页无文本"不是同一事实，故不匹配此正则。
 */
const ENGINE_EMPTY_REPORT = /no usable text/i;

/**
 * Normalize `OcrPdfResult` (from `processPdfWithOcr`) to 0-indexed
 * `NormalizedPdfDocument`. Uses NAPI's real `pageCount`.
 *
 * `textItems` is optional; populate it via `extractTextWithPositions` at the
 * call site when needed (it is a synchronous blocking NAPI call).
 *
 * 退化护栏：对经过推理引擎的页（source ≠ Native）检测退化签名（全零/单字符
 * 支配/无内容），命中即置 `hostedRecommended` 并追加 `warnings`（引擎已报"无可
 * 用文本"的空页不重复追加告警文案）。三个 OCR 消费方——`recognize_text`
 * （local-ocr-service）、`extract_pdf_text`（pdf-extract-adapter）、
 * `convert_to_markdown`（ppt-master-service 的 convertPdfToMarkdown）——共用本
 * 函数，因此护栏只需在此处生效一次。原生提取路径（`normalizePagesExtraction`）
 * 不接护栏：该路径不产出 OCR 文本。
 */
export function normalizeOcrPdfResult(
  result: OcrPdfResult,
  textItems: TextItem[] = [],
): NormalizedPdfDocument {
  const itemsByPage = groupTextItemsByPage(textItems);

  const pages: NormalizedPage[] = result.pages.map((p) => {
    const source = p.provenance.source;
    // 复制上游数组：护栏不修改 NAPI 返回的对象，保证同一 result 二次归一化幂等。
    const warnings = [...(p.provenance.warnings ?? [])];
    let hostedRecommended = p.provenance.hostedRecommended ?? false;
    if (source !== 'Native') {
      const issue = detectDegeneracy(p.markdown);
      if (issue) {
        // 命中即标注不可采信，与引擎是否已置位无关；文案仅在引擎已报同类事实时不重复。
        hostedRecommended = true;
        if (!(issue.kind === 'empty' && warnings.some((w) => ENGINE_EMPTY_REPORT.test(w)))) {
          warnings.push(issue.message);
        }
      }
    }
    return {
      pageIndex: p.pageNumber - 1,
      markdown: p.markdown,
      needsOcr: source !== 'Native',
      ocrReason: undefined,
      textItems: itemsByPage.get(p.pageNumber - 1) ?? [],
      ocrProvenance: {
        source,
        ocrConfidence: p.provenance.ocrConfidence,
        hostedRecommended,
        warnings,
      },
    };
  });

  return {
    pageCount: result.pageCount,
    pdfType: UNKNOWN_PDF_TYPE,
    pages,
    pagesNeedingOcr: result.pagesRecommendedForOcr.map((p) => p - 1),
    pagesWithTables: result.pagesWithTables.map((p) => p - 1),
    pagesWithColumns: result.pagesWithColumns.map((p) => p - 1),
    processingTimeMs: result.processingTimeMs,
    isComplexLayout: result.isComplex,
    hasEncodingIssues: false,
    confidence: 0,
  };
}
