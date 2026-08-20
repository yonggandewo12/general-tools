import { describe, it, expect } from 'vitest';
import { renderJson } from '../src/pdf-engine/json-renderer.js';
import { makeBlock, makeDoc } from './test-pdf-fixtures.js';

describe('json-renderer', () => {
  it('emits page and block structure with bbox', () => {
    const json = renderJson(makeDoc([
      makeBlock({ type: 'heading', text: 'Title', headingLevel: 1, y: 100, height: 24 }),
      makeBlock({ type: 'paragraph', text: 'Body', y: 130 }),
    ]));
    expect(json.pageCount).toBe(1);
    const page = json.pages[0];
    expect(page.pageNum).toBe(1);
    expect(page.blocks).toHaveLength(2);
    expect(page.blocks[0]).toMatchObject({ type: 'heading', headingLevel: 1, text: 'Title', bbox: { x: 72, y: 100 } });
  });
});
