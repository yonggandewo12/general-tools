import * as path from 'path';
import { promises as fs } from 'fs';
// @ts-ignore - pdfjs-dist legacy build 未捆绑 TS 类型声明，运行时可用
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfRawImage, RawPage } from './types.js';

export interface ParseOptions {
  password?: string;
  maxPages?: number;
  targetPages?: number[];
  extractImages?: boolean;
}

const IMAGE_RESOLVE_TIMEOUT = 5000;
const OPS = pdfjsLib.OPS;

// 限制并发数执行异步任务，保持结果顺序
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  // 并发数至少为 1，避免传入 0/负数时 workers 为空导致 results 全为 undefined
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// 判断字体是否粗体：启发式匹配常见粗体关键字
function isBoldName(fontName: string): boolean {
  return /bold|black|heavy|semibold|demibold/i.test(fontName);
}

interface PdfjsTextItem {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
  fontName?: string;
  hasEOL?: boolean;
}

interface PdfjsImageData {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8ClampedArray;
}

export async function parsePdf(
  input: Buffer | Uint8Array | string,
  options: ParseOptions = {},
): Promise<{ pageCount: number; pages: RawPage[] }> {
  let data: Uint8Array;
  if (typeof input === 'string') {
    const buf = await fs.readFile(path.resolve(input));
    data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } else if (Buffer.isBuffer(input)) {
    data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else if (input instanceof Uint8Array) {
    data = input;
  } else {
    throw new TypeError('parsePdf input must be a file path, Buffer, or Uint8Array');
  }

  // @ts-ignore - pdfjs-dist legacy build 类型不完整
  const loadingTask = pdfjsLib.getDocument({
    data,
    password: options.password,
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;

  try {
    const pageCount = pdf.numPages;

    const pageNums = options.targetPages && options.targetPages.length > 0
      ? options.targetPages.filter((p) => p >= 1 && p <= pageCount)
      : Array.from({ length: Math.min(pageCount, options.maxPages ?? 1000) }, (_, i) => i + 1);

    const rawPages = await mapWithConcurrency(pageNums, 4, async (pageNum) => {
      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();

        const items: RawPage['items'] = [];
        const textItems = content.items as unknown as PdfjsTextItem[];
        for (const it of textItems) {
          const str = it.str ?? '';
          if (!str.trim()) continue;
          const t = it.transform ?? [1, 0, 0, 1, 0, 0];
          const fontScale = Math.abs(t[0]);
          const rawY = t[5]; // PDF 底部原点（基线）
          // 翻转为 top-down，取文本顶部：top = height - (baseline + fontSize)
          const topDownY = viewport.height - rawY - fontScale;
          items.push({
            str,
            x: t[4],
            y: topDownY,
            width: it.width ?? str.length * fontScale,
            height: it.height ?? fontScale,
            fontSize: fontScale,
            fontName: it.fontName ?? '',
            isBold: isBoldName(it.fontName ?? ''),
            hasEOL: !!it.hasEOL,
          });
        }

        const images = options.extractImages === false
          ? []
          : await extractImages(page, viewport);
        return {
          pageNum,
          width: viewport.width,
          height: viewport.height,
          items,
          images,
        };
      } catch (err) {
        // 单页解析失败：跳过该页，不中断整体
        console.warn(`[pdf-source] page ${pageNum} skipped: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    });
    const pages = rawPages.filter((p): p is RawPage => p !== null);

    return { pageCount, pages };
  } finally {
    // 释放 pdfjs 资源，避免长驻进程内存增长
    await loadingTask.destroy().catch(() => {});
  }
}

// 2x2 PDF 变换矩阵 [a,b,c,d,e,f]（pdfjs 约定：x' = a*x + c*y + e; y' = b*x + d*y + f）
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

// 单位正方形四角经矩阵变换后的包围盒（PDF 用户坐标，底部原点）
function transformUnitSquare(m: Matrix): { x1: number; y1: number; x2: number; y2: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const x = m[0] * u + m[2] * v + m[4];
    const y = m[1] * u + m[3] * v + m[5];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x1: minX, y1: minY, x2: maxX, y2: maxY };
}

// 等待 pdfjs 异步解析图片对象
function resolveImageObject(
  page: any,
  name: string,
): Promise<PdfjsImageData | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish(null), IMAGE_RESOLVE_TIMEOUT);
    const finish = (img: PdfjsImageData | null) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(img);
      }
    };
    try {
      page.objs.get(name, (img: PdfjsImageData | null) => finish(img));
    } catch {
      finish(null);
    }
  });
}

async function extractImages(
  // @ts-ignore - pdfjs legacy build 无类型声明
  page: any,
  viewport: { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] },
): Promise<PdfRawImage[]> {
  try {
    const opList = await page.getOperatorList();
    const out: PdfRawImage[] = [];

    // 重放操作符列表，跟踪 CTM 以计算图片真实摆放位置
    const stack: Matrix[] = [];
    let ctm: Matrix = IDENTITY;

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];
      if (fn === OPS.transform) {
        ctm = multiply(ctm, args as Matrix);
        continue;
      }
      if (fn === OPS.save) {
        stack.push(ctm);
        continue;
      }
      if (fn === OPS.restore) {
        ctm = stack.pop() ?? IDENTITY;
        continue;
      }
      if (fn !== OPS.paintImageXObject && fn !== OPS.paintImageXObjectRepeat) continue;
      if (!args) continue;

      const name = args[0];
      const img = await resolveImageObject(page, name);
      if (!img || !img.data || img.width <= 0 || img.height <= 0) continue;

      let placements: Matrix[];
      if (fn === OPS.paintImageXObjectRepeat) {
        const scaleX = typeof args[1] === 'number' ? args[1] : 1;
        const scaleY = typeof args[2] === 'number' ? args[2] : 1;
        const positions = args[3] as number[] | undefined ?? [];
        placements = [];
        for (let p = 0; p + 1 < positions.length; p += 2) {
          placements.push(multiply(ctm, [scaleX, 0, 0, scaleY, positions[p], positions[p + 1]]));
        }
      } else {
        placements = [ctm];
      }

      for (const m of placements) {
        const box = transformUnitSquare(m);
        // PDF 底部原点 → viewport 顶部原点（处理旋转/缩放）
        const [vx1, vy1] = viewport.convertToViewportPoint(box.x1, box.y1);
        const [vx2, vy2] = viewport.convertToViewportPoint(box.x2, box.y2);
        const left = Math.min(vx1, vx2);
        const top = Math.min(vy1, vy2);
        const right = Math.max(vx1, vx2);
        const bottom = Math.max(vy1, vy2);
        out.push({
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
          pixelWidth: img.width,
          pixelHeight: img.height,
          kind: img.kind ?? 3,
          data: new Uint8Array(img.data),
          format: 'png',
        });
      }
    }
    return out;
  } catch (err) {
    console.warn(`[pdf-source] image extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
