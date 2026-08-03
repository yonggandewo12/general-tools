import { TextBlock, TextLine } from '../types.js';
import { HEADING_SIZE } from './constants.js';

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

    // 标题状边界切换（粗体变化，或跨越标题字号阈值）视为新块
    const lastHeadingLike = lastLine.isBold || lastLine.fontSize >= HEADING_SIZE;
    const lnHeadingLike = ln.isBold || ln.fontSize >= HEADING_SIZE;
    const styleTransition = lastHeadingLike !== lnHeadingLike;

    const xOverlap = ln.x < last.x + last.width && ln.x + ln.width > last.x;
    if (gap <= gapTolerance && sizeDiff < SIZE_RATIO && !styleTransition && xOverlap) {
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
