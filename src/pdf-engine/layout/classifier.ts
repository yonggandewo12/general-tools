import { TextBlock } from '../types.js';
import { HEADING_SIZE, headingLevelForSize } from './constants.js';

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

    // 代码：等宽字体
    if (isMono) {
      return { ...b, type: 'code' as const };
    }

    // 标题：粗体或大字号
    const isBold = firstLine.isBold;
    const size = firstLine.fontSize;
    if (isBold || size >= HEADING_SIZE) {
      return { ...b, type: 'heading' as const, headingLevel: headingLevelForSize(size) };
    }

    return { ...b, type: 'paragraph' as const };
  });
}
