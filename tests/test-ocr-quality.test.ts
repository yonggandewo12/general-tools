/**
 * OCR 退化护栏测试：`detectDegeneracy` 的判定边界，以及
 * `normalizeOcrPdfResult` 处护栏的接线契约。
 *
 * 全部离线：`ocr-quality.ts` 是纯函数，`pdf-inspector-types.ts` 只含 type-only
 * 原生导入，两者都不需要 PDFium / ONNX Runtime / 模型。
 */
import { describe, expect, it } from 'vitest';
import type { OcrPdfResult } from '@firecrawl/pdf-inspector';
import { detectDegeneracy } from '../src/ocr-quality.js';
import { normalizeOcrPdfResult } from '../src/pdf-inspector-types.js';

// === detectDegeneracy ===

describe('detectDegeneracy', () => {
  it('flags the all-zero signature produced by failing CPU backends', () => {
    const report = detectDegeneracy('0'.repeat(24));
    expect(report?.kind).toBe('zeroFill');
    expect(report?.message).toMatch(/silent-failure/);

    // 空白/换行/竖线等不参与统计，"分组书写的全零"仍须命中
    expect(detectDegeneracy('0000 0000\n0000 0000')?.kind).toBe('zeroFill');
  });

  it('flags single-character-dominant output', () => {
    const report = detectDegeneracy('的'.repeat(15));
    expect(report?.kind).toBe('repetitive');
    expect(report?.message).toContain('的');
  });

  it('counts code points, not UTF-16 units, for rare CJK characters', () => {
    // 中日韩扩展 B 区用字（古籍/人名常见）每字占 2 个 UTF-16 单元。按代码单元算
    // 会把占比压成 50%（低于阈值 → 漏报），并把长度门限虚高一倍（→ 误报）。
    const rare = '\u{2000B}'.repeat(15);
    expect(rare.length).toBe(30);
    const report = detectDegeneracy(rare);
    expect(report?.kind).toBe('repetitive');
    expect(report?.message).toContain('100% of 15 recognized characters');
    expect(detectDegeneracy('\u{2000B}'.repeat(6))).toBeUndefined();
  });

  it('flags pages with no recognizable characters at all', () => {
    expect(detectDegeneracy('')?.kind).toBe('empty');
    expect(detectDegeneracy('  \n\t ')?.kind).toBe('empty');
    // 只剩 markdown 骨架（表格边框/标题符）同样视为无内容
    expect(detectDegeneracy('| --- | --- |\n#')?.kind).toBe('empty');
    // emoji/符号不属字母数字，实测引擎对这类页也只返回空文本
    expect(detectDegeneracy('😀'.repeat(12))?.kind).toBe('empty');
  });

  it('treats a missing text field as empty rather than throwing', () => {
    expect(detectDegeneracy(undefined as unknown as string)?.kind).toBe('empty');
  });

  it('does not flag normal Chinese and mixed-language text', () => {
    for (const text of [
      '这是一个测试文档，包含中英文 mixed text 与数字 12345。',
      '床前明月光，疑是地上霜。举头望明月，低头思故乡。',
      'Invoice Total: $1,234.56 USD (Tax 7.2%) — paid on 2026-10-16.',
    ]) {
      expect(detectDegeneracy(text)).toBeUndefined();
    }
  });

  it('stays conservative near the thresholds', () => {
    // 全零但短于 ZERO_FILL_MIN：更可能是真实编号/年份，不告警
    expect(detectDegeneracy('0000')).toBeUndefined();
    // 长度达阈但不同字符数超过 REPETITIVE_MAX_DISTINCT
    expect(detectDegeneracy('a'.repeat(10) + 'bcd')).toBeUndefined();
    // 双字符交替：占比 0.5 低于 REPETITIVE_MIN_RATIO
    expect(detectDegeneracy('ab'.repeat(8))).toBeUndefined();
    // 数字表格页：竖线与空白被剔除后字符多样
    expect(detectDegeneracy('| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |')).toBeUndefined();
  });
});

// === 护栏接线（normalizeOcrPdfResult） ===

type PageSpec = {
  pageNumber: number;
  markdown: string;
  source?: 'Native' | 'Ocr' | 'Fused';
  hostedRecommended?: boolean;
  warnings?: string[];
};

function ocrResult(pages: PageSpec[]): OcrPdfResult {
  return {
    pageCount: pages.length,
    processingTimeMs: 1,
    isComplex: false,
    pagesRecommendedForOcr: [],
    pagesWithTables: [],
    pagesWithColumns: [],
    pages: pages.map((p) => ({
      pageNumber: p.pageNumber,
      markdown: p.markdown,
      provenance: {
        // 上游 `source` 是 `declare const enum`（无运行时值），字符串字面量无法满足
        // 其类型，只能在返回值处整体断言；src 侧的字段读取仍由 tsc 校验。
        source: p.source ?? 'Ocr',
        ocrConfidence: 0.9,
        hostedRecommended: p.hostedRecommended ?? false,
        warnings: p.warnings ?? [],
      },
    })),
  } as unknown as OcrPdfResult;
}

describe('OCR degeneracy guard in normalizeOcrPdfResult', () => {
  it('annotates a degenerate OCR page without discarding its content', () => {
    const doc = normalizeOcrPdfResult(ocrResult([{ pageNumber: 1, markdown: '0'.repeat(30) }]));
    const prov = doc.pages[0].ocrProvenance!;

    expect(prov.hostedRecommended).toBe(true);
    expect(prov.warnings).toHaveLength(1);
    expect(prov.warnings[0]).toMatch(/zero characters/);
    // 关键：只做标注，原文必须完整保留
    expect(doc.pages[0].markdown).toBe('0'.repeat(30));
  });

  it('leaves native-text pages untouched', () => {
    const doc = normalizeOcrPdfResult(
      ocrResult([{ pageNumber: 1, markdown: '0'.repeat(30), source: 'Native' }]),
    );
    expect(doc.pages[0].ocrProvenance!.hostedRecommended).toBe(false);
    expect(doc.pages[0].ocrProvenance!.warnings).toEqual([]);
  });

  it('leaves healthy OCR pages untouched', () => {
    const markdown = '领奖人：徐亮\n单位：技术部\n奖项：年度优秀工程师';
    const doc = normalizeOcrPdfResult(ocrResult([{ pageNumber: 1, markdown }]));
    expect(doc.pages[0].ocrProvenance!.hostedRecommended).toBe(false);
    expect(doc.pages[0].ocrProvenance!.warnings).toEqual([]);
  });

  it('preserves engine warnings and an already-set hostedRecommended', () => {
    const doc = normalizeOcrPdfResult(
      ocrResult([
        {
          pageNumber: 1,
          markdown: '的'.repeat(20),
          hostedRecommended: true,
          warnings: ['low confidence region'],
        },
      ]),
    );
    const prov = doc.pages[0].ocrProvenance!;
    expect(prov.hostedRecommended).toBe(true);
    expect(prov.warnings).toEqual(['low confidence region', expect.stringContaining('single repeated')]);
  });

  it('does not mutate the NAPI result and is idempotent across repeated normalization', () => {
    const warnings: string[] = [];
    const result = ocrResult([{ pageNumber: 1, markdown: '0'.repeat(30), warnings }]);

    const first = normalizeOcrPdfResult(result);
    const second = normalizeOcrPdfResult(result);

    expect(warnings).toEqual([]); // 上游数组未被就地追加
    expect(first.pages[0].ocrProvenance!.warnings).not.toBe(warnings);
    expect(second.pages[0].ocrProvenance!.warnings).toEqual(first.pages[0].ocrProvenance!.warnings);
  });

  it('does not duplicate the engine\'s own blank-page warning', () => {
    // 实测：空页时引擎自身返回 warnings: ['OCR produced no usable text']
    const doc = normalizeOcrPdfResult(
      ocrResult([
        {
          pageNumber: 1,
          markdown: '',
          hostedRecommended: true,
          warnings: ['OCR produced no usable text'],
        },
      ]),
    );
    expect(doc.pages[0].ocrProvenance!.warnings).toEqual(['OCR produced no usable text']);
    expect(doc.pages[0].ocrProvenance!.hostedRecommended).toBe(true);
  });

  it('does not dedup against the engine\'s span-level warning', () => {
    // 引擎另一条实测文案 'OCR spans with unusable text or geometry' 说的是"部分
    // 文本块被丢弃"，与"整页无可用文本"不是同一事实，护栏文案必须仍然出现。
    const doc = normalizeOcrPdfResult(
      ocrResult([
        {
          pageNumber: 1,
          markdown: '',
          warnings: ['12 OCR spans with unusable text or geometry'],
        },
      ]),
    );
    expect(doc.pages[0].ocrProvenance!.warnings).toHaveLength(2);
    expect(doc.pages[0].ocrProvenance!.warnings[1]).toMatch(/no letters or digits/);
  });

  it('marks the page incomplete even when the engine reports blankness without recommending one', () => {
    // 去重只去文案，不去结论：hostedRecommended 仍须由护栏置真
    const doc = normalizeOcrPdfResult(
      ocrResult([
        {
          pageNumber: 1,
          markdown: '| --- | --- |',
          hostedRecommended: false,
          warnings: ['OCR produced no usable text'],
        },
      ]),
    );
    expect(doc.pages[0].ocrProvenance!.hostedRecommended).toBe(true);
    expect(doc.pages[0].ocrProvenance!.warnings).toHaveLength(1);
  });

  it('appends its own message when an unrelated engine warning is present', () => {
    // 去重条件是"引擎报的正是无可用文本"，而非"引擎报了任何东西"
    const doc = normalizeOcrPdfResult(
      ocrResult([
        {
          pageNumber: 1,
          markdown: '',
          warnings: ['low confidence region'],
        },
      ]),
    );
    const prov = doc.pages[0].ocrProvenance!;
    expect(prov.warnings).toEqual(['low confidence region', expect.stringContaining('no letters or digits')]);
    expect(prov.hostedRecommended).toBe(true);
  });

  it('guards Fused pages as well as Ocr pages', () => {
    const doc = normalizeOcrPdfResult(
      ocrResult([{ pageNumber: 1, markdown: '了'.repeat(16), source: 'Fused' }]),
    );
    expect(doc.pages[0].ocrProvenance!.source).toBe('Fused');
    expect(doc.pages[0].ocrProvenance!.hostedRecommended).toBe(true);
    expect(doc.pages[0].ocrProvenance!.warnings[0]).toMatch(/single repeated/);
  });

  it('still flags a blank page the engine stayed silent about', () => {
    const doc = normalizeOcrPdfResult(ocrResult([{ pageNumber: 1, markdown: '   \n  ' }]));
    expect(doc.pages[0].ocrProvenance!.warnings).toHaveLength(1);
    expect(doc.pages[0].ocrProvenance!.hostedRecommended).toBe(true);
  });

  it('flags only the degenerate pages of a mixed document', () => {
    const doc = normalizeOcrPdfResult(
      ocrResult([
        { pageNumber: 1, markdown: '第一章 总则\n第一条 为规范流程，制定本规定。' },
        { pageNumber: 2, markdown: '0'.repeat(40) },
      ]),
    );
    expect(doc.pages[0].ocrProvenance!.hostedRecommended).toBe(false);
    expect(doc.pages[1].ocrProvenance!.hostedRecommended).toBe(true);
    expect(doc.pages[1].needsOcr).toBe(true);
  });
});
