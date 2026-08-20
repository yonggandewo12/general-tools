import { describe, it, expect } from 'vitest';
import { buildBlocks } from '../src/pdf-engine/layout/block-builder.js';
import { makeLine } from './test-pdf-fixtures.js';

describe('block-builder', () => {
  it('merges consecutive lines with small gap into one block', () => {
    const lines = [
      makeLine({ text: 'Line 1', y: 100 }),
      makeLine({ text: 'Line 2', y: 120 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain('Line 1');
    expect(blocks[0].text).toContain('Line 2');
  });

  it('splits blocks separated by a large gap', () => {
    const lines = [
      makeLine({ text: 'Para A', y: 100 }),
      makeLine({ text: 'Para B', y: 300 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks).toHaveLength(2);
  });

  it('splits blocks when font size changes significantly', () => {
    const lines = [
      makeLine({ text: 'Heading', y: 100, fontSize: 24, isBold: true }),
      makeLine({ text: 'Body', y: 130, fontSize: 12 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe('Heading');
  });

  it('splits at a heading-like size boundary (14pt + 12pt)', () => {
    const lines = [
      makeLine({ text: 'Section Heading', y: 100, fontSize: 14 }),
      makeLine({ text: 'Follow-up body sentence.', y: 116, fontSize: 12 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe('Section Heading');
    expect(blocks[1].text).toBe('Follow-up body sentence.');
  });

  it('keeps uniform 12pt lines merged into one paragraph', () => {
    const lines = [
      makeLine({ text: 'Line one', y: 100, fontSize: 12 }),
      makeLine({ text: 'Line two', y: 116, fontSize: 12 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain('Line two');
  });

  it('computes bbox from contained lines', () => {
    const lines = [
      makeLine({ text: 'A', y: 100, x: 72, width: 100 }),
      makeLine({ text: 'B', y: 120, x: 80, width: 50 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks[0].x).toBe(72);
    expect(blocks[0].width).toBe(100);
  });

  it('does not shrink bbox when a new line extends left but not right', () => {
    // Old code updated last.x = min(...) BEFORE computing width, so
    // width = max(old_w, ln.x + ln.w - new_x) used the already-shrunk x,
    // yielding 50 instead of the correct 58 (right=130 minus left=72).
    const lines = [
      makeLine({ text: 'A', y: 100, x: 80, width: 50 }),
      makeLine({ text: 'B', y: 120, x: 72, width: 10 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].x).toBe(72);
    expect(blocks[0].width).toBe(58);
    expect(blocks[0].height).toBe(32);
  });

  it('does not merge lines from adjacent columns', () => {
    const lines = [
      makeLine({ text: 'Left col', y: 100, x: 72, width: 80 }),
      makeLine({ text: 'Right col', y: 105, x: 300, width: 80 }),
    ];
    const blocks = buildBlocks(lines);
    expect(blocks).toHaveLength(2);
  });
});
