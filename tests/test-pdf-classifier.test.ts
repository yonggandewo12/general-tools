import { describe, it, expect } from 'vitest';
import { classifyBlocks } from '../src/pdf-engine/layout/classifier.js';
import { makeBlock } from './test-pdf-fixtures.js';

describe('classifier', () => {
  it('classifies large bold text as heading', () => {
    const b = classifyBlocks([makeBlock({ text: 'Big Title', y: 50, fontSize: 24, isBold: true })]);
    expect(b[0].type).toBe('heading');
    expect(b[0].headingLevel).toBe(1);
  });

  it('classifies normal text as paragraph', () => {
    const b = classifyBlocks([makeBlock({ text: 'Just some body copy.', y: 100, fontSize: 12 })]);
    expect(b[0].type).toBe('paragraph');
  });

  it('classifies bullet-prefixed text as list-item', () => {
    const b = classifyBlocks([makeBlock({ text: '- item one', y: 100, fontSize: 12 })]);
    expect(b[0].type).toBe('list-item');
  });

  it('classifies monospace text as code', () => {
    const b = classifyBlocks([makeBlock({ text: 'const a = 1;', y: 100, fontSize: 10, fontName: 'Courier' })]);
    expect(b[0].type).toBe('code');
  });

  it('classifies bottom-edge small text as footer', () => {
    const b = classifyBlocks([makeBlock({ text: 'Page 1', y: 760, fontSize: 9 })], 612, 792);
    expect(b[0].type).toBe('footer');
  });
});
