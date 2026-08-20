import { describe, it, expect } from 'vitest';
import { detectAndBuildTable } from '../src/pdf-engine/layout/table-structure.js';
import { TextLine, TextBlock, PdfRawItem } from '../src/pdf-engine/types.js';
import { makeBlock } from './test-pdf-fixtures.js';

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
const blockFromLines = (lines: TextLine[]): TextBlock => ({
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
    const table = detectAndBuildTable([blockFromLines(lines)]);
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
    expect(detectAndBuildTable([blockFromLines(lines)])).toBeNull();
  });

  it('extracts headers as first row', () => {
    const lines = [
      line('ColA ColB', 100, [{ x: 72 }, { x: 200 }]),
      line('1 2', 115, [{ x: 72 }, { x: 200 }]),
    ];
    const table = detectAndBuildTable([blockFromLines(lines)]);
    expect(table!.rows[0].map((c) => c.text)).toEqual(['ColA', 'ColB']);
  });

  it('merges consecutive paragraph blocks into a single table', () => {
    const lines1 = [line('Name Age', 100, [{ x: 72 }, { x: 200 }])];
    const lines2 = [line('Alice 30', 120, [{ x: 72 }, { x: 200 }])];
    const table = detectAndBuildTable([blockFromLines(lines1), blockFromLines(lines2)]);
    expect(table).not.toBeNull();
    expect(table!.rows).toHaveLength(2);
  });
});
