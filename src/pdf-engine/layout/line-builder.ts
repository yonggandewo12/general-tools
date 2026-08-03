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
