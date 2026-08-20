import { describe, it, expect } from 'vitest';
import { buildLines } from '../src/pdf-engine/layout/line-builder.js';
import { makeItem } from './test-pdf-fixtures.js';

describe('line-builder', () => {
  it('groups items on the same y into one line, sorted by x', () => {
    const items = [
      makeItem({ str: 'World', x: 120, y: 100 }),
      makeItem({ str: 'Hello', x: 10, y: 100 }),
    ];
    const lines = buildLines(items);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Hello World');
    expect(lines[0].x).toBe(10);
  });

  it('splits items with different y into separate lines', () => {
    const items = [
      makeItem({ str: 'top', x: 10, y: 50 }),
      makeItem({ str: 'bottom', x: 10, y: 100 }),
    ];
    const lines = buildLines(items);
    expect(lines).toHaveLength(2);
  });

  it('treats hasEOL as a hard line break', () => {
    const items = [
      makeItem({ str: 'A', x: 10, y: 100 }),
      makeItem({ str: 'B', x: 200, y: 100, hasEOL: true }),
      makeItem({ str: 'C', x: 10, y: 200 }),
    ];
    const lines = buildLines(items);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('A B');
  });

  it('detects bold and dominant font size', () => {
    const items = [
      makeItem({ str: 'A', x: 10, y: 100, fontSize: 20, isBold: true }),
      makeItem({ str: 'B', x: 60, y: 100, fontSize: 12, isBold: false }),
    ];
    const lines = buildLines(items);
    expect(lines[0].isBold).toBe(true);
    expect(lines[0].fontSize).toBe(20);
  });

  it('preserves items for table column detection', () => {
    const items = [
      makeItem({ str: 'X', x: 72, y: 100 }),
      makeItem({ str: 'Y', x: 200, y: 100 }),
    ];
    const lines = buildLines(items);
    expect(lines[0].items).toHaveLength(2);
    expect(lines[0].items![0].str).toBe('X');
  });
});
