import { parsePdf } from './pdf-source.js';
import { buildLines } from './layout/line-builder.js';
import { buildBlocks } from './layout/block-builder.js';
import { classifyBlocks } from './layout/classifier.js';
import { sortByReadingOrder } from './layout/reading-order.js';
import { detectAndBuildTable } from './layout/table-structure.js';
import { renderMarkdown, MarkdownRenderOptions } from './markdown-renderer.js';
import { renderJson, JsonDocument } from './json-renderer.js';
import { encodePng } from './png-encoder.js';
import { PdfDocument, TextBlock, TextLine } from './types.js';

export interface ParseDocumentOptions {
  outputFormat?: 'text' | 'json' | 'markdown';
  targetPages?: number[];
  maxPages?: number;
  password?: string;
  markdown?: MarkdownRenderOptions;
}

export interface ParsedImage {
  filename: string;
  data: Uint8Array;
}

export interface ParseDocumentResult {
  success: boolean;
  text?: string;
  markdown?: string;
  json?: JsonDocument;
  images?: ParsedImage[];
  pageCount?: number;
  scanPages?: number[];
  error?: string;
  details?: { processingTime: number };
}

export async function parseDocument(
  input: Buffer | Uint8Array | string,
  options: ParseDocumentOptions = {},
): Promise<ParseDocumentResult> {
  const start = Date.now();
  try {
    const format = options.outputFormat ?? 'text';
    const wantsImages = format !== 'text';
    const parsed = await parsePdf(input, {
      password: options.password,
      maxPages: options.maxPages,
      targetPages: options.targetPages,
      extractImages: wantsImages,
    });

    // 用原始页数据跑布局管线，组装 blocks
    const doc: PdfDocument = { pageCount: parsed.pageCount, pages: [] };
    const scanPages: number[] = [];
    for (const raw of parsed.pages) {
      const imageBlocks = raw.images.map((img) => ({
        type: 'image' as const,
        x: img.x, y: img.y, width: img.width, height: img.height,
        lines: [] as TextLine[], text: '', image: img,
      }));

      if (raw.items.length === 0) {
        scanPages.push(raw.pageNum);
        const blocks = sortByReadingOrder(imageBlocks, raw.width);
        doc.pages.push({ pageNum: raw.pageNum, width: raw.width, height: raw.height, blocks, scanPage: true });
        continue;
      }

      const lines = buildLines(raw.items);
      let blocks = buildBlocks(lines);
      blocks = classifyBlocks(blocks, raw.width, raw.height);

      // 表格检测：对连续段落块尝试重建表格
      blocks = mergeParagraphTables(blocks);

      blocks = [...blocks, ...imageBlocks];

      blocks = sortByReadingOrder(blocks, raw.width);
      doc.pages.push({ pageNum: raw.pageNum, width: raw.width, height: raw.height, blocks, scanPage: false });
    }

    // 输出格式化
    const result: ParseDocumentResult = {
      success: true,
      pageCount: parsed.pages.length,
      scanPages: scanPages.length > 0 ? scanPages : undefined,
      details: { processingTime: Date.now() - start },
    };
    if (format === 'text') {
      result.text = doc.pages.map((p) => p.blocks.map((b) => b.text).join('\n')).join('\n\n');
    } else if (format === 'markdown') {
      result.markdown = renderMarkdown(doc, options.markdown);
      // 与 markdown-renderer 的图片编号保持一致（按阅读顺序），供调用方落盘
      if ((options.markdown?.imageOutput ?? 'external') !== 'off') {
        result.images = await collectImages(doc);
      }
    } else {
      result.json = renderJson(doc);
    }
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      details: { processingTime: Date.now() - start },
    };
  }
}

// 对连续段落块分组做表格检测，避免 buildBlocks 因行间距把同一张表切成多个块
function mergeParagraphTables(blocks: TextBlock[]): TextBlock[] {
  const out: TextBlock[] = [];
  let run: TextBlock[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length >= 2) {
      const table = detectAndBuildTable(run);
      if (table) {
        const first = run[0];
        const last = run[run.length - 1];
        out.push({
          ...first,
          type: 'table',
          x: Math.min(...run.map((b) => b.x)),
          y: Math.min(...run.map((b) => b.y)),
          width: Math.max(...run.map((b) => b.x + b.width)) - Math.min(...run.map((b) => b.x)),
          height: last.y + last.height - first.y,
          lines: run.flatMap((b) => b.lines),
          text: run.map((b) => b.text).join('\n'),
          table,
        });
        run = [];
        return;
      }
    }
    out.push(...run);
    run = [];
  };
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      run.push(b);
    } else {
      flushRun();
      out.push(b);
    }
  }
  flushRun();
  return out;
}

// 按 markdown-renderer 相同的遍历顺序收集图片，编号 img-N.png 保持一致
async function collectImages(doc: PdfDocument): Promise<ParsedImage[]> {
  const out: ParsedImage[] = [];
  let count = 0;
  for (const page of doc.pages) {
    for (const b of page.blocks) {
      if (b.type !== 'image' || !b.image) continue;
      count++;
      const img = b.image;
      const png = await encodePng(img.pixelWidth, img.pixelHeight, img.kind, img.data);
      if (png) out.push({ filename: `img-${count}.png`, data: png });
    }
  }
  return out;
}
