import { TextBlock } from '../types.js';

export function sortByReadingOrder(blocks: TextBlock[], pageWidth: number): TextBlock[] {
  const MIN_COLUMN_GAP = 40; // 小于此水平间隙视为同一列
  const MIN_SPAN_RATIO = 0.6; // 块宽占页宽比例 ≥ 此值视为跨栏

  if (blocks.length <= 1) return blocks;

  // 分离"跨栏块"（宽块先行），其余按列切割
  const spans = blocks.filter((b) => b.width >= pageWidth * MIN_SPAN_RATIO);
  const nonSpans = blocks.filter((b) => b.width < pageWidth * MIN_SPAN_RATIO);

  const sortedColumns: TextBlock[] = [];
  if (nonSpans.length > 0) {
    // 按 x 聚类成列，同时跟踪当前列最右边界
    const columns: TextBlock[][] = [];
    let colRight = -Infinity;
    const sortedByX = [...nonSpans].sort((a, b) => a.x - b.x);
    for (const b of sortedByX) {
      const lastCol = columns[columns.length - 1];
      if (lastCol && b.x - colRight < MIN_COLUMN_GAP) {
        lastCol.push(b);
        if (b.x + b.width > colRight) colRight = b.x + b.width;
      } else {
        columns.push([b]);
        colRight = b.x + b.width;
      }
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
