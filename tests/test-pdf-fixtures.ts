import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { PdfRawItem, TextLine, TextBlock, PdfDocument, PdfRawImage } from '../src/pdf-engine/types.js';

// 生成单页 PDF：指定位置文本行（yTop 是从顶部算的距离，pdf-lib 用底部基线）
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

export function makeItem(partial: Partial<PdfRawItem> & { str: string }): PdfRawItem {
  return {
    x: 0, y: 0, width: 10, height: 10, fontSize: 12,
    fontName: 'Helvetica', isBold: false, hasEOL: false, ...partial,
  };
}

export function makeLine(partial: Partial<TextLine> & { text: string }): TextLine {
  return {
    x: 72, y: 0, width: 200, height: 12, fontSize: 12, isBold: false, fontName: 'Helvetica',
    ...partial,
  };
}

export function makeBlock(partial: Partial<TextBlock> & { text: string }): TextBlock {
  const fontSize = partial.fontSize ?? partial.lines?.[0]?.fontSize ?? 12;
  const y = partial.y ?? partial.lines?.[0]?.y ?? 0;
  const line: TextLine = {
    x: 72, y, width: 200, height: fontSize, text: partial.text, fontSize,
    isBold: partial.isBold ?? false, fontName: partial.fontName ?? 'Helvetica',
  };
  return {
    type: 'unknown', x: 72, y, width: 200, height: fontSize,
    lines: [line],
    text: partial.text,
    ...partial,
    lines: partial.lines ?? [line],
  };
}

export function makeDoc(blocks: TextBlock[]): PdfDocument {
  return { pageCount: 1, pages: [{ pageNum: 1, width: 612, height: 792, blocks, scanPage: false }] };
}

export function makeImageBlock(partial: Partial<TextBlock> & { image: PdfRawImage }): TextBlock {
  return {
    type: 'image', x: 0, y: 0, width: 100, height: 50, lines: [], text: '', ...partial,
  };
}
