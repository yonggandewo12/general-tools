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
    // pageCount 反映本次实际解析并返回的页数（与 targetPages/maxPages 选取范围一致，
    // 单页失败已在 pdf-source 跳过并告警），便于调用方判断返回内容规模。
    const result: ParseDocumentResult = {
      success: true,
      pageCount: parsed.pages.length,
      scanPages: scanPages.length > 0 ? scanPages : undefined,
      details: { processingTime: Date.now() - start },
    };
    if (format === 'text') {
      result.text = doc.pages.map((p) => p.blocks.map((b) => b.text).join('\n')).join('\n\n');
    } else if (format === 'markdown') {
      // 先编码图片：编码失败的 image block 会被清除 image 字段，
      // 随后 renderMarkdown 只对保留的 image block 编号，保证 markdown 引用
      // 与 result.images 的文件名/编号严格一致，不会出现引用缺失或错位。
      if ((options.markdown?.imageOutput ?? 'external') !== 'off') {
        result.images = await collectImages(doc);
      }
      result.markdown = renderMarkdown(doc, options.markdown);
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

// 按 markdown-renderer 相同的遍历顺序收集图片，编号 img-N.png 保持一致。
// 编码失败的 image block 会被置空 b.image，使后续 renderMarkdown 跳过它，
// 从而 markdown 引用与落盘文件一一对应、编号连续无错位。
async function collectImages(doc: PdfDocument): Promise<ParsedImage[]> {
  const out: ParsedImage[] = [];
  let count = 0;
  for (const page of doc.pages) {
    for (const b of page.blocks) {
      if (b.type !== 'image' || !b.image) continue;
      const img = b.image;
      const png = await encodePng(img.pixelWidth, img.pixelHeight, img.kind, img.data);
      if (png) {
        count++;
        out.push({ filename: `img-${count}.png`, data: png });
      } else {
        // 编码失败：清除引用，renderMarkdown 将跳过该块，编号不前移
        b.image = undefined;
      }
    }
  }
  return out;
}
