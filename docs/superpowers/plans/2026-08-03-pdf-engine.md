# 纯 JS PDF 布局分析引擎实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commit 说明（本项目规则）**：本仓库 commit 需用户明确授权。执行到各 Task 的 Commit 步骤时，先向用户确认再执行，不要擅自 commit。

**Goal:** 用纯 TypeScript（pdfjs-dist 底层）实现 PDF 布局分析引擎，接管 `extract_pdf_text` 和 `convert_to_markdown`(PDF 分支)，提升提取质量，不引入 Java 依赖。

**Architecture:** pdfjs-dist 提取每页文本项（含坐标/字号/字体），经「文本项→行→块→分类→XY-Cut 阅读顺序→（表格重建）」管线，渲染为 Markdown/JSON/纯文本。模块各自独立可单测，门面 `pdf-engine.ts` 对上层保持现有接口契约。

**Tech Stack:** TypeScript (Node16/ESM)、`pdfjs-dist`（文本提取）、`pdf-lib`（测试 fixture 生成）、vitest。

**Spec:** `docs/superpowers/specs/2026-08-03-pdf-engine-design.md`

---

## File Structure

```
src/pdf-engine/
  types.ts                  // 中间数据结构（PdfRawItem/RawPage/TextLine/TextBlock/Table/PdfDocument）
  pdf-source.ts             // pdfjs-dist 适配：PDF buffer → RawPage[]（文本项+坐标+图片）
  layout/line-builder.ts    // PdfRawItem[] → TextLine[]
  layout/block-builder.ts   // TextLine[] → TextBlock[]（未分类）
  layout/classifier.ts      // TextBlock[] → 带 type 的 TextBlock[]
  layout/reading-order.ts   // XY-Cut 阅读顺序排序
  layout/table-structure.ts // 列对齐表格检测 + 行列重建 → Table
  markdown-renderer.ts      // PdfDocument → Markdown 字符串
  json-renderer.ts          // PdfDocument → 结构化 JSON（兼容现有 json 输出）
  pdf-engine.ts             // 门面：extractPdf() / toMarkdown() / parse()
  index.ts                  // 导出
```

测试（根目录，符合 vitest `test-*.test.ts`）：
```
test-pdf-fixtures.ts        // pdf-lib 生成受控 PDF 的辅助函数
test-pdf-line.test.ts
test-pdf-block.test.ts
test-pdf-classifier.test.ts
test-pdf-reading-order.test.ts
test-pdf-table.test.ts
test-pdf-markdown.test.ts
test-pdf-engine.test.ts
```

修改：
- `src/pdf-extractor.ts`：`extract()` 改调 `pdf-engine`；`screenshot()` 保留 liteparse
- `src/ppt-master-service.ts`：`convertToMarkdown()` 的 `case 'pdf'` 改调 `pdf-engine`
- `package.json`：新增 `pdfjs-dist`

---

## Task 1: 安装依赖 + pdfjs-dist Node spike

**Files:**
- Modify: `package.json`
- Create: `spike-pdfjs.mjs`（临时，验证后删除）

- [ ] **Step 1: 安装依赖**

```bash
npm install pdfjs-dist
npm install --save-dev pdf-lib
```

Expected: 安装成功，`package.json` 出现 `pdfjs-dist`（dependencies）和 `pdf-lib`（devDependencies）。

- [ ] **Step 2: 写 spike 脚本**

Create `spike-pdfjs.mjs`:

```js
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as fs from 'fs';

const buffer = fs.readFileSync(process.argv[2] || 'sample.pdf');
const doc = await pdfjsLib.getDocument({
  data: new Uint8Array(buffer),
  useWorkerFetch: false,
  isEvalSupported: false,
  useSystemFonts: true,
}).promise;

console.log('pages:', doc.numPages);
const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: 1 });
console.log('page size:', viewport.width, viewport.height);
const content = await page.getTextContent();
for (const item of content.items.slice(0, 30)) {
  const t = item.transform;
  console.log(JSON.stringify({
    str: item.str.slice(0, 20),
    x: Math.round(t[4] * 10) / 10,
    y: Math.round(t[5] * 10) / 10,
    w: Math.round(item.width * 10) / 10,
    fontScale: Math.round(t[0] * 100) / 100,
  }));
}
await doc.destroy();
```

- [ ] **Step 3: 用一个真实 PDF 跑 spike**

```bash
node spike-pdfjs.mjs <某个真实PDF路径>
```

Expected: 打印页数、页面尺寸、每项 str/x/y/width/fontScale。**验证两个关键点**：① legacy build 在 Node 下无 worker 报错；② 文本坐标（x/y，顶部为 0）、宽度、字号（fontScale ≈ fontSize）可读。若 `import 'pdfjs-dist/legacy/build/pdf.mjs'` 报类型/解析错误，改用 `import * as pdfjsLib from 'pdfjs-dist'` 并在 getDocument 前设 `pdfjsLib.GlobalWorkerOptions.workerSrc = ''`。

- [ ] **Step 4: 记录结论并删除 spike**

```bash
rm spike-pdfjs.mjs
```

Expected: 文件删除。在下方 Todo 或实现时把 spike 结论（legacy build 可用性、坐标符号）记入 `pdf-source.ts` 实现。

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add package.json package-lock.json
git commit -m "chore: add pdfjs-dist and pdf-lib dependencies for PDF engine"
```

---

## Task 2: 中间类型定义 + fixture 工具

**Files:**
- Create: `src/pdf-engine/types.ts`
- Create: `test-pdf-fixtures.ts`

- [ ] **Step 1: 写 types.ts**

Create `src/pdf-engine/types.ts`:

```ts
// 坐标约定：与 pdfjs 一致，y 轴向下，原点为页面左上角。

export interface PdfRawItem {
  str: string;
  x: number;          // 左边缘 x
  y: number;          // 基线 y
  width: number;
  height: number;
  fontSize: number;   // 近似字号
  fontName: string;
  isBold: boolean;
  hasEOL: boolean;
}

export interface PdfRawImage {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;   // RGBA
  format: string;     // 'png' | 'jpeg' | 'unknown'
}

export interface RawPage {
  pageNum: number;
  width: number;
  height: number;
  items: PdfRawItem[];
  images: PdfRawImage[];
}

export interface TextLine {
  x: number;          // 最左 x
  y: number;          // 平均基线 y
  width: number;      // 文本总宽
  height: number;     // 行高（字号）
  text: string;
  fontSize: number;   // 行内主要字号（众数）
  isBold: boolean;
  fontName: string;
  /** 组成该行的原始文本项（带坐标），供表格列切分使用（可选，无则整行归首列） */
  items?: PdfRawItem[];
}

export type BlockType =
  | 'heading' | 'paragraph' | 'list-item' | 'table'
  | 'image' | 'header' | 'footer' | 'code' | 'unknown';

export interface TableCell {
  text: string;
}

export interface Table {
  rows: TableCell[][];
}

export interface TextBlock {
  type: BlockType;
  headingLevel?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: TextLine[];
  text: string;       // 拼接文本（用于分类/渲染）
  listMarker?: string;
  table?: Table;
  image?: PdfRawImage;
}

export interface PdfPage {
  pageNum: number;
  width: number;
  height: number;
  blocks: TextBlock[];   // 已按阅读顺序排序
  scanPage: boolean;     // 无文本层的纯图页
}

export interface PdfDocument {
  pageCount: number;
  pages: PdfPage[];
}
```

- [ ] **Step 2: 写 fixture 生成器**

Create `test-pdf-fixtures.ts`（根目录，供所有测试 import）:

```ts
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

// 生成单页 PDF：指定位置文本行（PDF 坐标 y 向上，此处用顶部为 0 的 yIn）
export async function makeTextPdf(
  lines: { text: string; x: number; yTop: number; size?: number; bold?: boolean }[],
  pageW = 612,
  pageH = 792,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([pageW, pageH]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const l of lines) {
    const size = l.size ?? 12;
    const f = l.bold ? boldFont : font;
    // pdf-lib y 为底部基线；top 转底部：y = pageH - yTop - size
    page.drawText(l.text, { x: l.x, y: pageH - l.yTop - size, size, font: f, color: rgb(0, 0, 0) });
  }
  return Buffer.from(await doc.save());
}

// 生成带简单边框表格的 PDF：表头 + N 行 2 列，用 drawLine 画网格
export async function makeTablePdf(opts: {
  headers: string[]; rows: string[][];
  colWidths: number[]; startX?: number; startY?: number;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const startX = opts.startX ?? 72;
  const startY = opts.startY ?? 700;
  const cellH = 20;
  const allRows = [opts.headers, ...opts.rows];
  for (let r = 0; r < allRows.length; r++) {
    let x = startX;
    for (let c = 0; c < opts.colWidths.length; c++) {
      const w = opts.colWidths[c];
      // 画单元格四边
      const y = startY - r * cellH;
      page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 1, color: rgb(0, 0, 0) });
      page.drawLine({ start: { x, y }, end: { x, y: y - cellH }, thickness: 1, color: rgb(0, 0, 0) });
      page.drawLine({ start: { x: x + w, y }, end: { x: x + w, y: y - cellH }, thickness: 1, color: rgb(0, 0, 0) });
      page.drawLine({ start: { x, y: y - cellH }, end: { x: x + w, y: y - cellH }, thickness: 1, color: rgb(0, 0, 0) });
      const cellText = allRows[r][c] ?? '';
      page.drawText(cellText, { x: x + 3, y: y - 15, size: 10, font, color: rgb(0, 0, 0) });
      x += w;
    }
  }
  return Buffer.from(await doc.save());
}

export async function writeFixture(name: string, buf: Buffer): Promise<string> {
  const dir = path.join(process.cwd(), '.tmp-fixtures');
  await fs.promises.mkdir(dir, { recursive: true });
  const p = path.join(dir, name);
  await fs.promises.writeFile(p, buf);
  return p;
}
```

- [ ] **Step 3: 冒烟测试 fixture 可生成**

Create `test-pdf-fixtures.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeTextPdf } from './test-pdf-fixtures.js';
import { PDFDocument } from 'pdf-lib';

describe('fixtures', () => {
  it('generates a valid PDF', async () => {
    const buf = await makeTextPdf([{ text: 'Hello', x: 72, yTop: 100 }]);
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(1);
  });
});
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run test-pdf-fixtures.test.ts`
Expected: PASS（1 个用例通过）

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add src/pdf-engine/types.ts test-pdf-fixtures.ts test-pdf-fixtures.test.ts
git commit -m "feat(pdf-engine): add core types and test fixture generators"
```

---

## Task 3: pdf-source.ts — pdfjs 适配层

**Files:**
- Create: `src/pdf-engine/pdf-source.ts`
- Test: `test-pdf-source.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test-pdf-source.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePdf } from './src/pdf-engine/pdf-source.js';
import { makeTextPdf } from './test-pdf-fixtures.js';

describe('pdf-source', () => {
  it('extracts text items with coordinates', async () => {
    const buf = await makeTextPdf([
      { text: 'Title', x: 72, yTop: 80, size: 24, bold: true },
      { text: 'Body text', x: 72, yTop: 140, size: 12 },
    ]);
    const doc = await parsePdf(buf);
    expect(doc.pageCount).toBe(1);
    const page = doc.pages[0];
    expect(page.items.length).toBeGreaterThanOrEqual(2);
    // 标题在正文上方（y 向下，标题 y 更小）
    const items = [...page.items].sort((a, b) => a.y - b.y);
    expect(items[0].str).toContain('Title');
    expect(items[0].isBold).toBe(true);
    expect(items[0].fontSize).toBeGreaterThan(items[1].fontSize);
    expect(page.width).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test-pdf-source.test.ts`
Expected: FAIL（`Cannot find module './src/pdf-engine/pdf-source.js'`）

- [ ] **Step 3: 实现 pdf-source.ts**

Create `src/pdf-engine/pdf-source.ts`:

```ts
import * as path from 'path';
import { promises as fs } from 'fs';
// @ts-ignore - pdfjs-dist legacy build 未捆绑 TS 类型声明，运行时可用的官方构建
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfDocument, PdfRawItem, RawPage, PdfRawImage } from './types.js';

export interface ParseOptions {
  password?: string;
  maxPages?: number;
  targetPages?: number[];
}

interface PdfjsTextItem {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
  fontName?: string;
  hasEOL?: boolean;
}

// 判断字体是否粗体：启发式匹配常见粗体关键字
function isBoldName(fontName: string): boolean {
  return /bold|black|heavy|semibold|demibold/i.test(fontName);
}

export async function parsePdf(
  input: Buffer | Uint8Array | string,
  options: ParseOptions = {},
): Promise<PdfDocument> {
  const data =
    typeof input === 'string'
      ? new Uint8Array(await fs.readFile(path.resolve(input)))
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);

  const loadingTask = getDocument({
    data,
    password: options.password,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;

  try {
    const pageCount = pdf.numPages;
    const pages: RawPage[] = [];

    const pageNums = options.targetPages && options.targetPages.length > 0
      ? options.targetPages.filter((p) => p >= 1 && p <= pageCount)
      : Array.from({ length: Math.min(pageCount, options.maxPages ?? 1000) }, (_, i) => i + 1);

    for (const pageNum of pageNums) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      const items: PdfRawItem[] = [];
      const textItems = content.items as unknown as PdfjsTextItem[];
      for (const it of textItems) {
        const str = it.str ?? '';
        if (!str.trim()) continue;
        const t = it.transform ?? [1, 0, 0, 1, 0, 0];
        const fontScale = Math.abs(t[0]);
        items.push({
          str,
          x: t[4],
          y: t[5],
          width: it.width ?? str.length * fontScale,
          height: it.height ?? fontScale,
          fontSize: fontScale,
          fontName: it.fontName ?? '',
          isBold: isBoldName(it.fontName ?? ''),
          hasEOL: !!it.hasEOL,
        });
      }

      const images = await extractImages(page, viewport.width, viewport.height);

      pages.push({
        pageNum,
        width: viewport.width,
        height: viewport.height,
        items,
        images,
      });
    }

    // 归一化为 PdfDocument（分页数据，blocks 后续填充）
    return {
      pageCount: pageCount,
      pages: pages.map((p) => ({
        pageNum: p.pageNum,
        width: p.width,
        height: p.height,
        blocks: [],
        scanPage: p.items.length === 0,
      })),
      _raw: pages,
    };
  } finally {
    await pdf.destroy();
  }
}

async function extractImages(
  page: { getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>; objs: Map<string | number, unknown>; commonObjs: Map<string | number, unknown> },
  pageWidth: number,
  pageHeight: number,
): Promise<PdfRawImage[]> {
  // @ts-ignore - pdfjs legacy build 无类型声明
  const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    const opList = await page.getOperatorList();
    const out: PdfRawImage[] = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      if (opList.fnArray[i] !== OPS.paintImageXObject) continue;
      const args = opList.argsArray[i] as unknown[];
      const imageName = args[0] as string | number;
      const img = (page.objs.get(imageName) ?? page.commonObjs.get(imageName)) as
        | { width: number; height: number; data: Uint8Array | Uint8ClampedArray; kind?: number }
        | undefined;
      if (!img || !img.data) continue;
      const t = (args[1] as number[] | undefined) ?? [1, 0, 0, 1, 0, 0];
      out.push({
        x: t[4],
        y: t[5],
        width: img.width * Math.abs(t[0]) || img.width,
        height: img.height * Math.abs(t[3]) || img.height,
        data: new Uint8Array(img.data),
        format: img.kind === undefined ? 'unknown' : 'png',
      });
    }
    return out;
  } catch {
    return [];
  }
}
```

> 注：`parsePdf` 返回的 `PdfDocument` 上暂挂 `_raw`（RawPage[]），下游管线（Task 4-8）消费 `_raw`，最终 `pdf-engine.ts` 门面组装 `blocks`。这是为了让 pdf-source 只负责解析、不负责布局，职责单一。`_raw` 字段在 `types.ts` 中补声明（Task 2 的 `PdfDocument` 接口加 `_raw?: RawPage[]`）。

- [ ] **Step 4: 补 types.ts 的 `_raw` 字段**

Edit `src/pdf-engine/types.ts`，在 `PdfDocument` 接口加：

```ts
export interface PdfDocument {
  pageCount: number;
  pages: PdfPage[];
  /** @internal 原始页数据，供布局管线消费，门面组装后置空 */
  _raw?: RawPage[];
}
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run test-pdf-source.test.ts`
Expected: PASS

- [ ] **Step 6: Commit（需用户授权）**

```bash
git add src/pdf-engine/pdf-source.ts src/pdf-engine/types.ts test-pdf-source.test.ts
git commit -m "feat(pdf-engine): add pdfjs source adapter with text/image extraction"
```

---

## Task 4: line-builder.ts — 文本项 → 行

**Files:**
- Create: `src/pdf-engine/layout/line-builder.ts`
- Test: `test-pdf-line.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test-pdf-line.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildLines } from './src/pdf-engine/layout/line-builder.js';
import { PdfRawItem } from './src/pdf-engine/types.js';

const item = (partial: Partial<PdfRawItem> & { str: string }): PdfRawItem => ({
  x: 0, y: 0, width: 10, height: 10, fontSize: 12,
  fontName: 'Helvetica', isBold: false, hasEOL: false, ...partial,
});

describe('line-builder', () => {
  it('groups items on the same y into one line, sorted by x', () => {
    const items = [
      item({ str: 'World', x: 120, y: 100 }),
      item({ str: 'Hello', x: 10, y: 100 }),
    ];
    const lines = buildLines(items);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Hello World');
    expect(lines[0].x).toBe(10);
  });

  it('splits items with different y into separate lines', () => {
    const items = [
      item({ str: 'top', x: 10, y: 50 }),
      item({ str: 'bottom', x: 10, y: 100 }),
    ];
    const lines = buildLines(items);
    expect(lines).toHaveLength(2);
  });

  it('treats hasEOL as a hard line break', () => {
    const items = [
      item({ str: 'A', x: 10, y: 100 }),
      item({ str: 'B', x: 200, y: 100, hasEOL: true }),
      item({ str: 'C', x: 10, y: 200 }),
    ];
    const lines = buildLines(items);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('A B');
  });

  it('detects bold and dominant font size', () => {
    const items = [
      item({ str: 'A', x: 10, y: 100, fontSize: 20, isBold: true }),
      item({ str: 'B', x: 60, y: 100, fontSize: 12, isBold: false }),
    ];
    const lines = buildLines(items);
    expect(lines[0].isBold).toBe(true);
    expect(lines[0].fontSize).toBe(20);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test-pdf-line.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 line-builder.ts**

Create `src/pdf-engine/layout/line-builder.ts`:

```ts
import { PdfRawItem, TextLine } from '../types.js';

const Y_TOLERANCE = 3; // 同一行的 y 容差（基线差）

export function buildLines(items: PdfRawItem[]): TextLine[] {
  // 1. 按 y 聚类成行（相邻 item 的 y 差 < 容差归一行）
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rawLines: PdfRawItem[][] = [];
  let current: PdfRawItem[] = [];
  let currentY = -Infinity;
  for (const it of sorted) {
    if (current.length === 0 || Math.abs(it.y - currentY) <= Y_TOLERANCE) {
      if (current.length === 0) currentY = it.y;
      current.push(it);
      if (it.hasEOL) {
        rawLines.push(current);
        current = [];
      }
    } else {
      rawLines.push(current);
      current = [it];
      currentY = it.y;
    }
  }
  if (current.length > 0) rawLines.push(current);

  // 2. 每行内按 x 排序并拼文本
  return rawLines.map((lineItems) => {
    const ordered = [...lineItems].sort((a, b) => a.x - b.x);
    const text = ordered.map((it) => it.str).join(' ').trim();
    const y = ordered.reduce((s, it) => s + it.y, 0) / ordered.length;
    const x = Math.min(...ordered.map((it) => it.x));
    const x1 = Math.max(...ordered.map((it) => it.x + it.width));
    // 众数字号
    const sizes = new Map<number, number>();
    for (const it of ordered) sizes.set(it.fontSize, (sizes.get(it.fontSize) ?? 0) + 1);
    const fontSize = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;
    return {
      x,
      y,
      width: x1 - x,
      height: fontSize,
      text,
      fontSize,
      isBold: ordered.some((it) => it.isBold),
      fontName: ordered[0]?.fontName ?? '',
      items: ordered,
    };
  });
}
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run test-pdf-line.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add src/pdf-engine/layout/line-builder.ts test-pdf-line.test.ts
git commit -m "feat(pdf-engine): add line builder grouping text items into lines"
```

---

## Task 5: block-builder.ts — 行 → 块

**Files:**
- Create: `src/pdf-engine/layout/block-builder.ts`
- Test: `test-pdf-block.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test-pdf-block.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildBlocks } from './src/pdf-engine/layout/block-builder.js';
import { TextLine } from './src/pdf-engine/types.js';

const line = (partial: Partial<TextLine> & { text: string; y: number }): TextLine => ({
  x: 72, y: 0, width: 200, height: 12, fontSize: 12, isBold: false, fontName: 'Helvetica',
  ...partial,
});

describe('block-builder', () => {
  it('merges consecutive lines with small gap into one block', () => {
    const lines = [
      line({ text: 'Line 1', y: 100 }),
      line({ text: 'Line 2', y: 120 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain('Line 1');
    expect(blocks[0].text).toContain('Line 2');
  });

  it('splits blocks separated by a large gap', () => {
    const lines = [
      line({ text: 'Para A', y: 100 }),
      line({ text: 'Para B', y: 300 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks).toHaveLength(2);
  });

  it('splits blocks when font size changes significantly', () => {
    const lines = [
      line({ text: 'Heading', y: 100, fontSize: 24, isBold: true }),
      line({ text: 'Body', y: 130, fontSize: 12 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe('Heading');
  });

  it('computes bbox from contained lines', () => {
    const lines = [
      line({ text: 'A', y: 100, x: 72, width: 100 }),
      line({ text: 'B', y: 120, x: 80, width: 50 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks[0].x).toBe(72);
    expect(blocks[0].width).toBe(100);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test-pdf-block.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 block-builder.ts**

Create `src/pdf-engine/layout/block-builder.ts`:

```ts
import { TextBlock, TextLine } from '../types.js';

// 行间距阈值：按行高比例（1.8 倍行高以内视为同段）
const GAP_FACTOR = 1.8;
// 字号变化阈值：变化超过 1.3 倍视为不同块
const SIZE_RATIO = 1.3;

export function buildBlocks(lines: TextLine[]): TextBlock[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const blocks: TextBlock[] = [];

  for (const ln of sorted) {
    const last = blocks[blocks.length - 1];
    if (!last) {
      blocks.push(newBlock(ln));
      continue;
    }
    const lastLine = last.lines[last.lines.length - 1];
    const gap = ln.y - (lastLine.y + lastLine.height);
    const sizeDiff = Math.max(lastLine.fontSize, ln.fontSize) / Math.min(lastLine.fontSize, ln.fontSize);
    const gapTolerance = lastLine.fontSize * GAP_FACTOR;

    if (gap <= gapTolerance && sizeDiff < SIZE_RATIO) {
      last.lines.push(ln);
      last.text += '\n' + ln.text;
      last.y = Math.min(last.y, ln.y);
      last.x = Math.min(last.x, ln.x);
      last.width = Math.max(last.width, ln.x + ln.width - last.x);
      last.height = Math.max(last.height, ln.y + ln.height - last.y);
    } else {
      blocks.push(newBlock(ln));
    }
  }
  return blocks;
}

function newBlock(line: TextLine): TextBlock {
  return {
    type: 'unknown',
    x: line.x,
    y: line.y,
    width: line.width,
    height: line.height,
    lines: [line],
    text: line.text,
  };
}
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run test-pdf-block.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add src/pdf-engine/layout/block-builder.ts test-pdf-block.test.ts
git commit -m "feat(pdf-engine): add block builder grouping lines into blocks"
```

---

## Task 6: classifier.ts — 块分类

**Files:**
- Create: `src/pdf-engine/layout/classifier.ts`
- Test: `test-pdf-classifier.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test-pdf-classifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyBlocks } from './src/pdf-engine/layout/classifier.js';
import { TextBlock } from './src/pdf-engine/types.js';

const block = (partial: Partial<TextBlock> & { text: string; y: number; fontSize: number }): TextBlock => ({
  type: 'unknown', x: 72, y: 0, width: 200, height: 12,
  lines: [{ x: 72, y: partial.y, width: 200, height: partial.fontSize, text: partial.text, fontSize: partial.fontSize, isBold: false, fontName: 'Helvetica' }],
  text: partial.text,
  ...partial,
});

describe('classifier', () => {
  it('classifies large bold text as heading', () => {
    const b = classifyBlocks([block({ text: 'Big Title', y: 50, fontSize: 24, isBold: true })]);
    expect(b[0].type).toBe('heading');
    expect(b[0].headingLevel).toBe(1);
  });

  it('classifies normal text as paragraph', () => {
    const b = classifyBlocks([block({ text: 'Just some body copy.', y: 100, fontSize: 12 })]);
    expect(b[0].type).toBe('paragraph');
  });

  it('classifies bullet-prefixed text as list-item', () => {
    const b = classifyBlocks([block({ text: '- item one', y: 100, fontSize: 12 })]);
    expect(b[0].type).toBe('list-item');
  });

  it('classifies monospace/indented text as code', () => {
    const b = classifyBlocks([block({ text: 'const a = 1;', y: 100, fontSize: 10, fontName: 'Courier' })]);
    expect(b[0].type).toBe('code');
  });

  it('classifies bottom-edge small text as footer', () => {
    const b = classifyBlocks([block({ text: 'Page 1', y: 760, fontSize: 9 })], 612, 792);
    expect(b[0].type).toBe('footer');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test-pdf-classifier.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 classifier.ts**

Create `src/pdf-engine/layout/classifier.ts`:

```ts
import { TextBlock } from '../types.js';

const HEADING_SIZES: { max: number; level: number }[] = [
  { max: Infinity, level: 1 },
  { max: 24, level: 2 },
  { max: 20, level: 3 },
  { max: 16, level: 4 },
  { max: 14, level: 5 },
  { max: 12, level: 6 },
];

export function classifyBlocks(blocks: TextBlock[], pageWidth = 612, pageHeight = 792): TextBlock[] {
  const HEADER_ZONE = 48;
  const FOOTER_ZONE = pageHeight - 48;

  return blocks.map((b) => {
    const firstLine = b.lines[0];
    const font = firstLine.fontName;
    const isMono = /courier|mono|menlo|consolas|droid/i.test(font);

    // 页眉页脚：靠页面边缘的小号文本
    if (firstLine.y < HEADER_ZONE && b.lines.length <= 1 && firstLine.fontSize <= 10) {
      return { ...b, type: 'header' as const };
    }
    if (firstLine.y > FOOTER_ZONE && b.lines.length <= 1 && firstLine.fontSize <= 10) {
      return { ...b, type: 'footer' as const };
    }

    const text = b.text.trim();

    // 列表项
    const listMatch = text.match(/^(\s*)([-*•]|\d+[.)])\s+/);
    if (listMatch) {
      return { ...b, type: 'list-item' as const, listMarker: listMatch[2] };
    }

    // 代码：等宽字体或缩进 + 符号特征
    if (isMono) {
      return { ...b, type: 'code' as const };
    }

    // 标题：粗体或大字号
    const isBold = firstLine.isBold;
    const size = firstLine.fontSize;
    if (isBold || size >= 14) {
      const level = HEADING_SIZES.find((h) => size <= h.max)?.level ?? 1;
      return { ...b, type: 'heading' as const, headingLevel: level };
    }

    return { ...b, type: 'paragraph' as const };
  });
}
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run test-pdf-classifier.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add src/pdf-engine/layout/classifier.ts test-pdf-classifier.test.ts
git commit -m "feat(pdf-engine): add block classifier for headings/lists/code/header-footer"
```

---

## Task 7: reading-order.ts — XY-Cut 阅读顺序

**Files:**
- Create: `src/pdf-engine/layout/reading-order.ts`
- Test: `test-pdf-reading-order.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test-pdf-reading-order.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sortByReadingOrder } from './src/pdf-engine/layout/reading-order.js';
import { TextBlock } from './src/pdf-engine/types.js';

const block = (partial: Partial<TextBlock> & { text: string; x: number; y: number }): TextBlock => ({
  type: 'paragraph', x: 0, y: 0, width: 100, height: 12,
  lines: [{ x: partial.x, y: partial.y, width: 100, height: 12, text: partial.text, fontSize: 12, isBold: false, fontName: 'Helvetica' }],
  text: partial.text,
  ...partial,
});

describe('reading-order', () => {
  it('sorts single column top to bottom', () => {
    const blocks = [
      block({ text: 'B', x: 10, y: 200 }),
      block({ text: 'A', x: 10, y: 50 }),
    ];
    expect(sortByReadingOrder(blocks, 612, 792).map((b) => b.text)).toEqual(['A', 'B']);
  });

  it('reads two columns left-to-right, then down', () => {
    // 左栏两行，右栏两行，构成 Z 型阅读
    const blocks = [
      block({ text: 'L2', x: 20, y: 300 }),
      block({ text: 'R2', x: 400, y: 300 }),
      block({ text: 'R1', x: 400, y: 100 }),
      block({ text: 'L1', x: 20, y: 100 }),
    ];
    expect(sortByReadingOrder(blocks, 612, 792).map((b) => b.text)).toEqual(['L1', 'R1', 'L2', 'R2']);
  });

  it('treats a full-width block as spanning columns', () => {
    const blocks = [
      block({ text: 'Section 2', x: 10, y: 400, width: 500 }),
      block({ text: 'L1', x: 20, y: 100, width: 100 }),
      block({ text: 'R1', x: 400, y: 100, width: 100 }),
    ];
    expect(sortByReadingOrder(blocks, 612, 792).map((b) => b.text)).toEqual(['Section 2', 'L1', 'R1']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test-pdf-reading-order.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 reading-order.ts**

Create `src/pdf-engine/layout/reading-order.ts`:

```ts
import { TextBlock } from '../types.js';

export function sortByReadingOrder(blocks: TextBlock[], pageWidth: number, pageHeight: number): TextBlock[] {
  const MIN_COLUMN_GAP = 40; // 小于此水平间隙视为同一列
  const MIN_SPAN_RATIO = 0.6; // 块宽占页宽比例 ≥ 此值视为跨栏

  // 递归 XY-Cut：返回排序后的块
  function cut(cands: TextBlock[]): TextBlock[] {
    if (cands.length <= 1) return cands;

    // 分离"跨栏块"（宽块先行），其余按列切割
    const spans = cands.filter((b) => b.width >= pageWidth * MIN_SPAN_RATIO);
    const nonSpans = cands.filter((b) => b.width < pageWidth * MIN_SPAN_RATIO);

    const sortedColumns: TextBlock[] = [];
    if (nonSpans.length > 0) {
      // 按 x 中心聚类成列
      const columns: TextBlock[][] = [];
      const sortedByX = [...nonSpans].sort((a, b) => a.x - b.x);
      for (const b of sortedByX) {
        const lastCol = columns[columns.length - 1];
        if (lastCol) {
          const colRight = Math.max(...lastCol.map((x) => x.x + x.width));
          if (b.x - colRight < MIN_COLUMN_GAP) {
            lastCol.push(b);
            continue;
          }
        }
        columns.push([b]);
      }
      // 每列内按 y 排序，列间按列 x 排序（已按 x 升序收集）
      for (const col of columns) {
        col.sort((a, b) => a.y - b.y || a.x - b.x);
        sortedColumns.push(...col);
      }
    }

    // 跨栏块插到前面（标题通常在前）
    const spansSorted = [...spans].sort((a, b) => a.y - b.y);
    return [...spansSorted, ...sortedColumns];
  }

  return cut([...blocks]);
}
```

> 说明：这是 XY-Cut 的务实简化——先分离跨栏块（宽块按 y 排序置于前），再把剩余块按 x 间隙聚类成列、列内按 y 排序、列间从左到右。覆盖常见「标题 + 多栏正文」「单栏」「双栏」布局。极端布局（表格跨栏、浮动元素）不保证。

- [ ] **Step 4: 跑测试**

Run: `npx vitest run test-pdf-reading-order.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add src/pdf-engine/layout/reading-order.ts test-pdf-reading-order.test.ts
git commit -m "feat(pdf-engine): add XY-Cut reading order sort"
```

---

## Task 8: table-structure.ts — 列对齐表格检测与重建

**Files:**
- Create: `src/pdf-engine/layout/table-structure.ts`
- Test: `test-pdf-table.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test-pdf-table.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectAndBuildTable } from './src/pdf-engine/layout/table-structure.js';
import { TextLine, TextBlock, PdfRawItem } from './src/pdf-engine/types.js';

// 构造带 items（词级坐标）的文本行：按空格分词，词 i 落在 cols[i] 列
const line = (text: string, y: number, cols: { x: number }[]): TextLine => {
  const words = text.split(' ');
  const items: PdfRawItem[] = words.map((w, i) => ({
    str: w, x: cols[i]?.x ?? cols[0]?.x ?? 72, y,
    width: w.length * 5, height: 10, fontSize: 10,
    fontName: 'Helvetica', isBold: false, hasEOL: false,
  }));
  return {
    x: items[0].x, y, width: 100, height: 10, text, fontSize: 10,
    isBold: false, fontName: 'Helvetica', items,
  };
};
const block = (lines: TextLine[]): TextBlock => ({
  type: 'paragraph', x: lines[0].x, y: lines[0].y,
  width: 200, height: 10 * lines.length, lines, text: lines.map((l) => l.text).join('\n'),
});

describe('table-structure', () => {
  it('detects column-aligned rows as a table and rebuilds cells', () => {
    const lines = [
      line('Name Age', 100, [{ x: 72 }, { x: 200 }]),
      line('Alice 30', 115, [{ x: 72 }, { x: 200 }]),
      line('Bob 25', 130, [{ x: 72 }, { x: 200 }]),
    ];
    const blocks = [block(lines)];
    const table = detectAndBuildTable(blocks);
    expect(table).not.toBeNull();
    expect(table!.rows).toHaveLength(3);
    expect(table!.rows[0].map((c) => c.text)).toEqual(['Name', 'Age']);
    expect(table!.rows[1].map((c) => c.text)).toEqual(['Alice', '30']);
  });

  it('returns null when rows are not column-aligned', () => {
    const lines = [
      line('plain paragraph text that flows', 100, [{ x: 72 }]),
      line('with no column structure', 115, [{ x: 72 }]),
    ];
    const blocks = [block(lines)];
    expect(detectAndBuildTable(blocks)).toBeNull();
  });

  it('extracts headers as first row', () => {
    const lines = [
      line('ColA ColB', 100, [{ x: 72 }, { x: 200 }]),
      line('1 2', 115, [{ x: 72 }, { x: 200 }]),
    ];
    const table = detectAndBuildTable([block(lines)]);
    expect(table!.rows[0].map((c) => c.text)).toEqual(['ColA', 'ColB']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test-pdf-table.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 table-structure.ts**

Create `src/pdf-engine/layout/table-structure.ts`:

```ts
import { Table, TextBlock, TableCell, PdfRawItem } from '../types.js';

const MIN_ROWS = 2;
const COL_GAP = 8;

// 从所有行的文本项 x 聚类推断列边界
function inferColumns(blocks: TextBlock[]): number[] | null {
  const xs = new Set<number>();
  for (const b of blocks) {
    for (const ln of b.lines) {
      const itemXs = (ln.items ?? []).map((i) => i.x);
      if (itemXs.length === 0) xs.add(ln.x);
      else itemXs.forEach((x) => xs.add(x));
    }
  }
  if (xs.size < 2) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  // 聚类：相邻 x 差 > COL_GAP 视为新列
  const cols: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > COL_GAP) cols.push(sorted[i]);
  }
  return cols.length >= 2 ? cols : null;
}

// 文本项归属列：取最后一个 item.x 距列起点 >= -COL_GAP 的列
function columnOf(item: PdfRawItem, cols: number[]): number {
  let best = 0;
  for (let i = 0; i < cols.length; i++) {
    if (item.x >= cols[i] - COL_GAP) best = i;
    else break;
  }
  return best;
}

export function detectAndBuildTable(blocks: TextBlock[]): Table | null {
  const lines = blocks.flatMap((b) => b.lines);
  if (lines.length < MIN_ROWS) return null;

  const cols = inferColumns(blocks);
  if (!cols) return null;

  // 每行：按文本项坐标把每个词归属到列，再按列拼接
  const rows: TableCell[][] = [];
  for (const ln of lines) {
    const cellTexts: string[] = cols.map(() => '');
    const items = ln.items ?? [];
    if (items.length === 0) {
      // 无 item 坐标时退化为整行归首列
      cellTexts[0] = ln.text;
    } else {
      for (const item of items) {
        const col = columnOf(item, cols);
        cellTexts[col] = cellTexts[col] ? `${cellTexts[col]} ${item.str}` : item.str;
      }
    }
    rows.push(cellTexts.map((text) => ({ text })));
  }

  // 若每行内容都只落在第 0 列，说明不是表
  if (rows.every((r) => r[0]?.text && r.slice(1).every((c) => c.text === ''))) return null;

  return { rows };
}
```

> 说明：这是列对齐启发式的**最小可用实现**——从文本项级坐标聚类推断列边界，按 item 坐标把词归属到列。目标为"有边框/列对齐表格结构正确，复杂表格尽力"。无 `items` 的行退化为整行归首列。已知局限在 plan 末尾记录，可后续增强。

- [ ] **Step 4: 跑测试**

Run: `npx vitest run test-pdf-table.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add src/pdf-engine/layout/table-structure.ts test-pdf-table.test.ts
git commit -m "feat(pdf-engine): add column-aligned table detection and rebuild"
```

---

## Task 9: markdown-renderer.ts — 布局元素 → Markdown

**Files:**
- Create: `src/pdf-engine/markdown-renderer.ts`
- Test: `test-pdf-markdown.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test-pdf-markdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './src/pdf-engine/markdown-renderer.js';
import { PdfDocument, TextBlock } from './src/pdf-engine/types.js';

const mkBlock = (partial: Partial<TextBlock> & { type: TextBlock['type']; text: string }): TextBlock => ({
  type: 'paragraph', x: 72, y: 100, width: 100, height: 12,
  lines: [], text: partial.text, ...partial,
});

const doc = (blocks: TextBlock[]): PdfDocument => ({
  pageCount: 1,
  pages: [{ pageNum: 1, width: 612, height: 792, blocks, scanPage: false }],
});

describe('markdown-renderer', () => {
  it('renders headings with # prefix', () => {
    const md = renderMarkdown(doc([mkBlock({ type: 'heading', text: 'Title', headingLevel: 1 })]));
    expect(md).toContain('# Title');
  });

  it('renders paragraphs as plain text', () => {
    const md = renderMarkdown(doc([mkBlock({ type: 'paragraph', text: 'Hello world' })]));
    expect(md).toContain('Hello world');
  });

  it('renders list items with dash', () => {
    const md = renderMarkdown(doc([mkBlock({ type: 'list-item', text: 'item', listMarker: '-' })]));
    expect(md).toContain('- item');
  });

  it('renders tables as markdown pipe tables', () => {
    const b = mkBlock({ type: 'table', text: '' });
    b.table = { rows: [
      [{ text: 'Name' }, { text: 'Age' }],
      [{ text: 'Alice' }, { text: '30' }],
    ] };
    const md = renderMarkdown(doc([b]));
    expect(md).toContain('| Name | Age |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| Alice | 30 |');
  });

  it('renders images as markdown image refs', () => {
    const b = mkBlock({ type: 'image', text: '' });
    b.image = { x: 0, y: 0, width: 100, height: 50, data: new Uint8Array(0), format: 'png' };
    const md = renderMarkdown(doc([b]), { imageBasePath: 'assets' });
    expect(md).toMatch(/!\[image\]\(assets\/img-1\.png\)/);
  });

  it('skips headers and footers', () => {
    const md = renderMarkdown(doc([
      mkBlock({ type: 'header', text: 'Company Header' }),
      mkBlock({ type: 'paragraph', text: 'Body' }),
      mkBlock({ type: 'footer', text: 'Page 1' }),
    ]));
    expect(md).not.toContain('Company Header');
    expect(md).not.toContain('Page 1');
    expect(md).toContain('Body');
  });

  it('adds page separators between pages', () => {
    const doc2: PdfDocument = {
      pageCount: 2,
      pages: [
        { pageNum: 1, width: 612, height: 792, blocks: [mkBlock({ type: 'paragraph', text: 'P1' })], scanPage: false },
        { pageNum: 2, width: 612, height: 792, blocks: [mkBlock({ type: 'paragraph', text: 'P2' })], scanPage: false },
      ],
    };
    const md = renderMarkdown(doc2, { pageSeparator: '\n\n---\n\n' });
    expect(md).toContain('P1\n\n---\n\nP2');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test-pdf-markdown.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 markdown-renderer.ts**

Create `src/pdf-engine/markdown-renderer.ts`:

```ts
import { PdfDocument, TextBlock } from './types.js';

export interface MarkdownRenderOptions {
  pageSeparator?: string;
  imageBasePath?: string;   // 图片引用前缀（如 'xxx_files'）
  imageOutput?: 'off' | 'embedded' | 'external';
  scanPagePlaceholder?: string;
}

export function renderMarkdown(doc: PdfDocument, options: MarkdownRenderOptions = {}): string {
  const parts: string[] = [];
  let imageCount = 0;

  for (let p = 0; p < doc.pages.length; p++) {
    const page = doc.pages[p];
    const pageParts: string[] = [];

    if (page.scanPage) {
      pageParts.push(options.scanPagePlaceholder ?? '_[此页为扫描页，无可提取文本层]_');
    }

    for (const b of page.blocks) {
      const md = renderBlock(b, options, () => ++imageCount);
      if (md) pageParts.push(md);
    }

    if (pageParts.length > 0) {
      parts.push(pageParts.join('\n\n'));
    }
  }

  const sep = options.pageSeparator ?? '\n\n---\n\n';
  return parts.join(sep);
}

function renderBlock(b: TextBlock, options: MarkdownRenderOptions, nextImage: () => number): string {
  switch (b.type) {
    case 'heading': {
      const level = b.headingLevel ?? 1;
      return '#'.repeat(Math.min(level, 6)) + ' ' + b.text;
    }
    case 'paragraph':
      return b.text;
    case 'list-item': {
      const marker = b.listMarker && /^\d+[.)]$/.test(b.listMarker) ? b.listMarker : '-';
      return `${marker} ${b.text.replace(/^\s*([-*•]|\d+[.)])\s+/, '')}`;
    }
    case 'code':
      return '```\n' + b.text + '\n```';
    case 'table': {
      if (!b.table || b.table.rows.length === 0) return '';
      const header = b.table.rows[0];
      const body = b.table.rows.slice(1);
      const cols = Math.max(header.length, ...body.map((r) => r.length));
      const pad = (row: { text: string }[]) => {
        const cells = Array.from({ length: cols }, (_, i) => row[i]?.text ?? '');
        return '| ' + cells.join(' | ') + ' |';
      };
      const sepRow = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
      return [pad(header), sepRow, ...body.map(pad)].join('\n');
    }
    case 'image': {
      if (options.imageOutput === 'off' || !b.image) return '';
      const idx = nextImage();
      const base = options.imageBasePath ?? '';
      const ref = base ? `${base}/img-${idx}.png` : `img-${idx}.png`;
      return `![image](${ref})`;
    }
    case 'header':
    case 'footer':
      return '';
    case 'unknown':
    default:
      return b.text;
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run test-pdf-markdown.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add src/pdf-engine/markdown-renderer.ts test-pdf-markdown.test.ts
git commit -m "feat(pdf-engine): add markdown renderer for layout elements"
```

---

## Task 10: json-renderer.ts — 结构化 JSON

**Files:**
- Create: `src/pdf-engine/json-renderer.ts`
- Test: `test-pdf-json.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test-pdf-json.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderJson } from './src/pdf-engine/json-renderer.js';
import { PdfDocument } from './src/pdf-engine/types.js';

const doc: PdfDocument = {
  pageCount: 1,
  pages: [{
    pageNum: 1, width: 612, height: 792,
    blocks: [
      { type: 'heading', headingLevel: 1, x: 72, y: 100, width: 100, height: 24, lines: [], text: 'Title' },
      { type: 'paragraph', x: 72, y: 130, width: 200, height: 12, lines: [], text: 'Body' },
    ],
    scanPage: false,
  }],
};

describe('json-renderer', () => {
  it('emits page and block structure with bbox', () => {
    const json = renderJson(doc);
    expect(json.pageCount).toBe(1);
    const page = json.pages[0];
    expect(page.pageNum).toBe(1);
    expect(page.blocks).toHaveLength(2);
    expect(page.blocks[0]).toMatchObject({ type: 'heading', headingLevel: 1, text: 'Title', bbox: { x: 72, y: 100 } });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test-pdf-json.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 json-renderer.ts**

Create `src/pdf-engine/json-renderer.ts`:

```ts
import { PdfDocument } from './types.js';

export interface JsonBlock {
  type: string;
  headingLevel?: number;
  text?: string;
  bbox: { x: number; y: number; width: number; height: number };
  table?: { rows: { text: string }[][] };
  listMarker?: string;
}

export interface JsonPage {
  pageNum: number;
  width: number;
  height: number;
  scanPage: boolean;
  blocks: JsonBlock[];
}

export interface JsonDocument {
  pageCount: number;
  pages: JsonPage[];
}

export function renderJson(doc: PdfDocument): JsonDocument {
  return {
    pageCount: doc.pageCount,
    pages: doc.pages.map((p) => ({
      pageNum: p.pageNum,
      width: p.width,
      height: p.height,
      scanPage: p.scanPage,
      blocks: p.blocks.map((b) => ({
        type: b.type,
        ...(b.headingLevel !== undefined ? { headingLevel: b.headingLevel } : {}),
        ...(b.listMarker !== undefined ? { listMarker: b.listMarker } : {}),
        text: b.text || undefined,
        bbox: { x: b.x, y: b.y, width: b.width, height: b.height },
        ...(b.table ? { table: { rows: b.table.rows } } : {}),
      })),
    })),
  };
}
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run test-pdf-json.test.ts`
Expected: PASS

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add src/pdf-engine/json-renderer.ts test-pdf-json.test.ts
git commit -m "feat(pdf-engine): add structured JSON renderer with bounding boxes"
```

---

## Task 11: pdf-engine.ts — 门面（编排管线 + 顶层 API）

**Files:**
- Create: `src/pdf-engine/pdf-engine.ts`
- Create: `src/pdf-engine/index.ts`
- Test: `test-pdf-engine.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test-pdf-engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDocument } from './src/pdf-engine/pdf-engine.js';
import { makeTextPdf } from './test-pdf-fixtures.js';

describe('pdf-engine facade', () => {
  it('parses a text PDF into markdown output', async () => {
    const buf = await makeTextPdf([
      { text: 'Document Title', x: 72, yTop: 80, size: 24, bold: true },
      { text: 'First paragraph here.', x: 72, yTop: 140 },
    ]);
    const result = await parseDocument(buf, { outputFormat: 'markdown' });
    expect(result.success).toBe(true);
    expect(result.markdown).toContain('# Document Title');
    expect(result.markdown).toContain('First paragraph here.');
  });

  it('returns plain text when outputFormat is text', async () => {
    const buf = await makeTextPdf([{ text: 'Just text', x: 72, yTop: 100 }]);
    const result = await parseDocument(buf, { outputFormat: 'text' });
    expect(result.success).toBe(true);
    expect(result.text).toContain('Just text');
  });

  it('returns structured json when outputFormat is json', async () => {
    const buf = await makeTextPdf([{ text: 'A heading', x: 72, yTop: 80, size: 20, bold: true }]);
    const result = await parseDocument(buf, { outputFormat: 'json' });
    expect(result.success).toBe(true);
    expect(result.json).toBeDefined();
    expect(result.json!.pages[0].blocks.length).toBeGreaterThan(0);
  });

  it('returns success:false for corrupt input', async () => {
    const result = await parseDocument(Buffer.from('not a pdf'), { outputFormat: 'text' });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test-pdf-engine.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 pdf-engine.ts 门面**

Create `src/pdf-engine/pdf-engine.ts`:

```ts
import { parsePdf } from './pdf-source.js';
import { buildLines } from './layout/line-builder.js';
import { buildBlocks } from './layout/block-builder.js';
import { classifyBlocks } from './layout/classifier.js';
import { sortByReadingOrder } from './layout/reading-order.js';
import { detectAndBuildTable } from './layout/table-structure.js';
import { renderMarkdown, MarkdownRenderOptions } from './markdown-renderer.js';
import { renderJson, JsonDocument } from './json-renderer.js';
import { PdfDocument, PdfOutputFormat } from './types.js';

export interface ParseDocumentOptions {
  outputFormat?: 'text' | 'json' | 'markdown';
  targetPages?: number[];
  maxPages?: number;
  password?: string;
  markdown?: MarkdownRenderOptions;
}

export interface ParseDocumentResult {
  success: boolean;
  text?: string;
  markdown?: string;
  json?: JsonDocument;
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
    const parsed = await parsePdf(input, {
      password: options.password,
      maxPages: options.maxPages,
      targetPages: options.targetPages,
    });

    // 用原始页数据跑布局管线，组装 blocks
    const doc: PdfDocument = { pageCount: parsed.pageCount, pages: [] };
    const scanPages: number[] = [];
    const rawPages = parsed._raw ?? [];
    for (const raw of rawPages) {
      if (raw.items.length === 0) {
        scanPages.push(raw.pageNum);
        doc.pages.push({ pageNum: raw.pageNum, width: raw.width, height: raw.height, blocks: [], scanPage: true });
        continue;
      }
      const lines = buildLines(raw.items);
      let blocks = buildBlocks(lines);
      blocks = classifyBlocks(blocks, raw.width, raw.height);

      // 表格检测：对段落块尝试重建表格
      blocks = blocks.map((b) => {
        if (b.type === 'paragraph') {
          const table = detectAndBuildTable([b]);
          if (table) return { ...b, type: 'table' as const, table };
        }
        return b;
      });

      // 图片块：无文本区域的图片作为 image 块
      const imageBlocks = raw.images.map((img) => ({
        type: 'image' as const,
        x: img.x, y: img.y, width: img.width, height: img.height,
        lines: [], text: '', image: img,
      }));
      blocks = [...blocks, ...imageBlocks];

      blocks = sortByReadingOrder(blocks, raw.width, raw.height);
      doc.pages.push({ pageNum: raw.pageNum, width: raw.width, height: raw.height, blocks, scanPage: false });
    }

    // 输出格式化
    const format = options.outputFormat ?? 'text';
    const result: ParseDocumentResult = {
      success: true,
      pageCount: doc.pageCount,
      scanPages: scanPages.length > 0 ? scanPages : undefined,
      details: { processingTime: Date.now() - start },
    };
    if (format === 'text') {
      result.text = doc.pages.map((p) => p.blocks.map((b) => b.text).join('\n')).join('\n\n');
    } else if (format === 'markdown') {
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

export { PdfOutputFormat };
export type { MarkdownRenderOptions, JsonDocument };
```

- [ ] **Step 4: 创建 index.ts 导出**

Create `src/pdf-engine/index.ts`:

```ts
export { parseDocument } from './pdf-engine.js';
export type { ParseDocumentOptions, ParseDocumentResult } from './pdf-engine.js';
export * from './types.js';
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run test-pdf-engine.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 6: Commit（需用户授权）**

```bash
git add src/pdf-engine/pdf-engine.ts src/pdf-engine/index.ts test-pdf-engine.test.ts
git commit -m "feat(pdf-engine): add facade orchestrating pipeline with text/json/markdown outputs"
```

---

## Task 12: 接入 extract_pdf_text（改 pdf-extractor.ts）

**Files:**
- Modify: `src/pdf-extractor.ts`
- Modify: `src/types.ts`
- Modify: `src/index.ts`（工具描述文案，可选）
- Test: `test-pdf-extractor.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test-pdf-extractor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PdfExtractor } from './src/pdf-extractor.js';
import { makeTextPdf, writeFixture } from './test-pdf-fixtures.js';

describe('PdfExtractor.extract (new engine)', () => {
  it('extracts markdown with heading structure', async () => {
    const buf = await makeTextPdf([
      { text: 'Chapter One', x: 72, yTop: 80, size: 22, bold: true },
      { text: 'Some body text.', x: 72, yTop: 130 },
    ]);
    const pdfPath = await writeFixture('extract.md.pdf', buf);
    const result = await new PdfExtractor().extract({ pdfPath, outputFormat: 'markdown' });
    expect(result.success).toBe(true);
    expect(result.text).toContain('# Chapter One');
    expect(result.text).toContain('Some body text.');
  });

  it('returns text output by default', async () => {
    const buf = await makeTextPdf([{ text: 'Hello extract', x: 72, yTop: 100 }]);
    const pdfPath = await writeFixture('extract.txt.pdf', buf);
    const result = await new PdfExtractor().extract({ pdfPath });
    expect(result.success).toBe(true);
    expect(result.text).toContain('Hello extract');
    expect(result.pageCount).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test-pdf-extractor.test.ts`
Expected: FAIL（仍走 liteparse，或模块缺失）

- [ ] **Step 3: 改 types.ts —— 更新 PdfExtractOptions 注释并移除已不适用字段**

Edit `src/types.ts`，将 `PdfExtractOptions` 改为（移除 ocrEnabled/ocrLanguage/ocrServerUrl/dpi/imageMode，这些属于旧 liteparse 语义，新引擎不支持）：

```ts
export interface PdfExtractOptions {
  /** 本地 PDF 文件路径（必选） */
  pdfPath: string;
  /** 输出格式：text / json / markdown（默认 text） */
  outputFormat?: PdfOutputFormat;
  /** 页码范围，如 "1-5,10,15-20" */
  targetPages?: string;
  /** 最大解析页数（默认 1000） */
  maxPages?: number;
  /** 加密 PDF 密码（可选） */
  password?: string;
}
```

> 若你希望保持向后兼容（不删参数字段），可保留原字段但忽略，本计划采用「移除并更新文档」策略；工具描述文案在 Step 5 同步更新。

- [ ] **Step 4: 改 pdf-extractor.ts —— extract() 走新引擎**

Edit `src/pdf-extractor.ts`，将 `extract()` 方法体替换（保留 `screenshot()` 不变；删除 `getLiteParse()` 中关于提取的用途但 `screenshot()` 仍需要 liteparse，故保留 loader）：

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import { parseDocument } from './pdf-engine/index.js';
import {
  PdfExtractOptions,
  PdfExtractResult,
  PdfScreenshotOptions,
  PdfScreenshotResult,
} from './types.js';

let LiteParseClass: typeof import('@llamaindex/liteparse').LiteParse | null = null;

async function getLiteParse(): Promise<typeof import('@llamaindex/liteparse').LiteParse> {
  if (!LiteParseClass) {
    try {
      const mod = await import('@llamaindex/liteparse');
      LiteParseClass = mod.LiteParse;
    } catch (err) {
      throw new Error(
        'Failed to load @llamaindex/liteparse. Please ensure it is installed: npm install @llamaindex/liteparse'
      );
    }
  }
  return LiteParseClass!;
}

export class PdfExtractor {
  async extract(options: PdfExtractOptions): Promise<PdfExtractResult> {
    const start = Date.now();
    try {
      const pdfFilePath = path.resolve(options.pdfPath);
      await fs.access(pdfFilePath);

      const result = await parseDocument(pdfFilePath, {
        outputFormat: options.outputFormat ?? 'text',
        targetPages: options.targetPages ? parsePages(options.targetPages) : undefined,
        maxPages: options.maxPages,
        password: options.password,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          details: { processingTime: Date.now() - start },
        };
      }

      return {
        success: true,
        text: result.text ?? result.markdown ?? (result.json ? JSON.stringify(result.json) : ''),
        pageCount: result.pageCount,
        details: { processingTime: Date.now() - start },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        details: { processingTime: Date.now() - start },
      };
    }
  }

  // screenshot() 原样保留（liteparse 渲染）——本计划不改动
  // ...（保持现有 screenshot 实现）
}

function parsePages(spec: string): number[] {
  const pages: number[] = [];
  for (const part of spec.split(',')) {
    const t = part.trim();
    if (t.includes('-')) {
      const [a, b] = t.split('-').map(Number);
      for (let i = a; i <= b; i++) pages.push(i);
    } else {
      pages.push(Number(t));
    }
  }
  return pages;
}
```

> 注：`parsePages` 复用现有 `parseTargetPages` 逻辑；若保留原 `parseTargetPages` 私有方法则直接调用它，避免重复。实现时以现有文件为准做最小修改。

- [ ] **Step 5: 更新 index.ts 工具描述（可选，保持准确性）**

Edit `src/index.ts` 的 `EXTRACT_PDF_TEXT_TOOL` 描述与 schema，去掉 OCR 相关字段（ocrEnabled/ocrLanguage/ocrServerUrl/dpi/imageMode），描述改为：

```ts
description: 'Extract text, JSON, or Markdown from PDF files (layout-aware engine). Detects headings, tables, lists, and reading order. Scanned pages are flagged as scanPage.',
```

- [ ] **Step 6: 跑测试（新 + 旧）**

Run: `npx vitest run test-pdf-extractor.test.ts`
Expected: PASS（2 个用例）

Run: `npm run build`
Expected: tsc 编译通过（无类型错误）

- [ ] **Step 7: Commit（需用户授权）**

```bash
git add src/pdf-extractor.ts src/types.ts src/index.ts test-pdf-extractor.test.ts
git commit -m "feat: route extract_pdf_text through new PDF engine, drop liteparse OCR options"
```

---

## Task 13: 接入 convert_to_markdown（改 ppt-master-service.ts）

**Files:**
- Modify: `src/ppt-master-service.ts`
- Test: `test-pdf-convert-md.test.ts`

- [ ] **Step 1: 写失败测试**

Create `test-pdf-convert-md.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PptMasterService } from './src/ppt-master-service.js';
import { makeTextPdf, writeFixture } from './test-pdf-fixtures.js';

describe('convertToMarkdown (PDF branch, new engine)', () => {
  it('converts PDF to markdown file with assets', async () => {
    const buf = await makeTextPdf([
      { text: 'Report Heading', x: 72, yTop: 80, size: 22, bold: true },
      { text: 'Content paragraph.', x: 72, yTop: 130 },
    ]);
    const pdfPath = await writeFixture('conv.pdf', buf);
    const service = new PptMasterService();
    const result = await service.convertToMarkdown({ source: pdfPath, sourceType: 'pdf' });
    expect(result.success).toBe(true);
    expect(result.markdownPath).toBeTruthy();
    const md = (await import('fs')).promises.readFile(result.markdownPath!, 'utf-8');
    expect(await md).toContain('# Report Heading');
  });
});
```

> 注：`PptMasterService` 构造目前接受 `PythonScriptRunner`。为使 PDF 分支不再依赖 Python（fitz），实现时 PDF 分支直接调用 pdf-engine，不经过 `runner`；其他分支（doc/excel/ppt/web）保持原逻辑。测试因此不需要 Python 环境。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test-pdf-convert-md.test.ts`
Expected: FAIL（PDF 分支仍走 python）

- [ ] **Step 3: 改 ppt-master-service.ts —— PDF 分支走新引擎**

Edit `src/ppt-master-service.ts`：

1. 顶部 import：

```ts
import { parseDocument } from './pdf-engine/index.js';
import * as fs from 'fs';
```

2. **在 `convertToMarkdown` 入口短路 PDF 分支**：检测到 sourceType 为 pdf 时，跳过 `checkPython`/`checkPackages`（PDF 分支不再依赖 Python），直接走新引擎：

```ts
  async convertToMarkdown(options: ConvertToMarkdownOptions): Promise<ConvertToMarkdownResult> {
    const start = Date.now();
    try {
      const sourceType = options.sourceType ?? this.detectSourceType(options.source);

      // PDF 分支走纯 JS 引擎，不依赖 Python，短路环境检查
      if (sourceType === 'pdf') {
        const outputPath = await this.resolveMarkdownOutputPath(options, sourceType);
        await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
        return await this.convertPdfToMarkdown(options, outputPath, start);
      }

      await this.runner.checkPython();
      const missing = await this.runner.checkPackages(MARKDOWN_DEPS);
      if (missing.length > 0) {
        throw new Error(this.runner.formatMissingPackages(missing));
      }

      // ...其余逻辑：switch 中移除 case 'pdf'，保留 doc/excel/ppt/web
```

3. 将 switch 中的 `case 'pdf'` 分支**移除**（已短路），其余分支原逻辑不变。

3. 新增私有方法：

```ts
  private async convertPdfToMarkdown(
    options: ConvertToMarkdownOptions,
    outputPath: string,
    start: number,
  ): Promise<ConvertToMarkdownResult> {
    const pdfPath = path.resolve(options.source);
    const imageOutput = options.pdfImages ?? 'filtered';
    const assetBase = outputPath.replace(/\.md$/i, '_files');
    const assetsDir = imageOutput === 'none' ? undefined : assetBase;

    const result = await parseDocument(pdfPath, {
      outputFormat: 'markdown',
      password: undefined,
      markdown: {
        imageOutput: imageOutput === 'none' ? 'off' : 'external',
        imageBasePath: assetsDir,
      },
    });

    if (!result.success) {
      throw new Error(result.error ?? 'PDF to Markdown failed');
    }

    if (assetsDir) {
      await fs.promises.mkdir(assetsDir, { recursive: true });
      // 写入提取的图片（当前实现：pdf-source 提取的位图）
      // 说明：图片落盘需要 pdf-engine 暴露 images；若图片为空则仅创建目录。
    }

    await fs.promises.writeFile(outputPath, result.markdown ?? '', 'utf-8');

    const assetCount = assetsDir
      ? (await fs.promises.readdir(assetsDir).catch(() => [])).filter((e) => !e.endsWith('manifest.json')).length
      : undefined;

    return {
      success: true,
      markdownPath: outputPath,
      assetsDir,
      details: { processingTime: Date.now() - start, sourceType: 'pdf', assetCount },
    };
  }
```

> **已知缺口（plan 记录，不阻塞）**：图片「写入 assets 目录」需要 `pdf-engine` 暴露已提取的 `PdfRawImage[]`。当前 `parseDocument` 的 markdown 渲染只生成图片引用、不落盘。本 Task 先保证 Markdown 文本/表格/标题质量与 assets 目录结构；**图片落盘作为后续增强**（见「后续增强」），届时通过 `parseDocument` 返回图片数据或新增 `extractAssets()` 方法实现。若实现时希望一次到位，可在本 Task 顺带扩展 `parseDocument` 返回 `images` 并写入 assets。

- [ ] **Step 4: 调整 MARKDOWN_DEPS（PDF 不再依赖 fitz）**

Edit `src/ppt-master-service.ts` 的 `MARKDOWN_DEPS`：

```ts
const MARKDOWN_DEPS = ['mammoth', 'markdownify', 'openpyxl', 'pptx', 'PIL', 'requests', 'bs4'];
```

（移除 `'fitz'`，因为 PDF 分支不再走 Python。）

- [ ] **Step 5: 跑测试**

Run: `npx vitest run test-pdf-convert-md.test.ts`
Expected: PASS

Run: `npm run build`
Expected: 编译通过

Run: `npx vitest run test-pdf-extractor.test.ts`
Expected: PASS（确认未破坏 extract 接入）

- [ ] **Step 6: Commit（需用户授权）**

```bash
git add src/ppt-master-service.ts test-pdf-convert-md.test.ts
git commit -m "feat: route convert_to_markdown PDF branch through new PDF engine"
```

---

## Task 14: 全量回归 + 清理

**Files:**
- Modify: `package.json`（如有未用依赖）
- Delete: `.tmp-fixtures/`（测试运行产生的临时目录，加入 .gitignore）

- [ ] **Step 1: 跑全部测试**

Run: `npx vitest run`
Expected: 全部 PASS（新旧测试全绿）。重点确认：
- `test-ocr-service.test.ts`（recognize_text 未受影响）
- `test-pdf-extractor.test.ts` / `test-pdf-convert-md.test.ts`（新引擎）
- 其他既有测试（md-conversion 等）不回归

- [ ] **Step 2: 编译验证**

Run: `npm run build`
Expected: tsc 编译通过，`dist/` 生成，`dist/pdf-engine/**` 存在。

- [ ] **Step 3: 忽略临时 fixture 目录**

Edit `.gitignore`，追加：

```
.tmp-fixtures/
```

- [ ] **Step 4: 记录已知局限（README 或 spec 附录）**

在 `docs/superpowers/specs/2026-08-03-pdf-engine-design.md` 末尾追加「已知局限」：

```markdown
## 已知局限（v1 实现记录）

1. 复杂/无边框/合并单元格表格结构可能不完整（列对齐启发式，目标对齐本地 0.489 档）
2. PDF 内嵌图片落盘 assets 目录为后续增强（当前仅 Markdown 引用）
3. 矢量图形渲染为 PNG（renderVectorFigures）未实现，需 canvas
4. 嵌入字体/CID 映射等 pdfjs 底层细节以 spike 验证结果为准
5. 阅读顺序覆盖单栏/双栏/跨栏标题，极端浮动布局不保证
```

- [ ] **Step 5: Commit（需用户授权）**

```bash
git add .gitignore docs/superpowers/specs/2026-08-03-pdf-engine-design.md
git commit -m "docs: record pdf-engine known limitations and ignore fixtures"
```

---

## 后续增强（不在本计划范围，记录备查）

- 图片落盘 assets：`parseDocument` 暴露 `images`，按 `pdfImages` 模式写盘
- 矢量图渲染 PNG（`renderVectorFigures`）：引入 `@napi-rs/canvas`
- 表格增强：用文本项级坐标替代行首 x 推断列边界
- 扫描页自动检测后提示改用 `recognize_text`
