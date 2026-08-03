import { describe, it, expect } from 'vitest';
import { sortByReadingOrder } from './src/pdf-engine/layout/reading-order.js';
import { makeBlock } from './test-pdf-fixtures.js';

describe('reading-order', () => {
  it('sorts single column top to bottom', () => {
    const blocks = [
      makeBlock({ text: 'B', x: 10, y: 200, width: 100, height: 12 }),
      makeBlock({ text: 'A', x: 10, y: 50, width: 100, height: 12 }),
    ];
    expect(sortByReadingOrder(blocks, 612).map((b) => b.text)).toEqual(['A', 'B']);
  });

  it('reads two columns: left column fully, then right column', () => {
    const blocks = [
      makeBlock({ text: 'L2', x: 20, y: 300, width: 100, height: 12 }),
      makeBlock({ text: 'R2', x: 400, y: 300, width: 100, height: 12 }),
      makeBlock({ text: 'R1', x: 400, y: 100, width: 100, height: 12 }),
      makeBlock({ text: 'L1', x: 20, y: 100, width: 100, height: 12 }),
    ];
    expect(sortByReadingOrder(blocks, 612).map((b) => b.text)).toEqual(['L1', 'L2', 'R1', 'R2']);
  });

  it('treats a full-width block as spanning columns', () => {
    const blocks = [
      makeBlock({ text: 'Section', x: 10, y: 400, width: 500, height: 12 }),
      makeBlock({ text: 'L1', x: 20, y: 100, width: 100, height: 12 }),
      makeBlock({ text: 'R1', x: 400, y: 100, width: 100, height: 12 }),
    ];
    expect(sortByReadingOrder(blocks, 612).map((b) => b.text)).toEqual(['Section', 'L1', 'R1']);
  });
});
