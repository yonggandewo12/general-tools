import { Table, TextBlock, TableCell, PdfRawItem } from '../types.js';
import { clusterSortedByGap } from './cluster.js';

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
  const groups = clusterSortedByGap([...xs], COL_GAP);
  const cols = groups.map((g) => g[0]);
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
