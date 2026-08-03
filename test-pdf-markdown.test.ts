import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './src/pdf-engine/markdown-renderer.js';
import { makeBlock, makeDoc, makeImageBlock } from './test-pdf-fixtures.js';
import { PdfDocument, TextBlock } from './src/pdf-engine/types.js';

describe('markdown-renderer', () => {
  it('renders headings with # prefix', () => {
    const md = renderMarkdown(makeDoc([makeBlock({ type: 'heading', text: 'Title', headingLevel: 1 })]));
    expect(md).toContain('# Title');
  });

  it('renders paragraphs as plain text', () => {
    const md = renderMarkdown(makeDoc([makeBlock({ type: 'paragraph', text: 'Hello world' })]));
    expect(md).toContain('Hello world');
  });

  it('renders list items with dash', () => {
    const md = renderMarkdown(makeDoc([makeBlock({ type: 'list-item', text: 'item', listMarker: '-' })]));
    expect(md).toContain('- item');
  });

  it('renders tables as markdown pipe tables', () => {
    const b = makeBlock({ type: 'table', text: '' });
    b.table = { rows: [
      [{ text: 'Name' }, { text: 'Age' }],
      [{ text: 'Alice' }, { text: '30' }],
    ] };
    const md = renderMarkdown(makeDoc([b]));
    expect(md).toContain('| Name | Age |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| Alice | 30 |');
  });

  it('renders images as markdown image refs', () => {
    const b = makeImageBlock({
      image: { x: 0, y: 0, width: 100, height: 50, pixelWidth: 1, pixelHeight: 1, kind: 3, data: new Uint8Array(0), format: 'png' },
    });
    const md = renderMarkdown(makeDoc([b]), { imageBasePath: 'assets' });
    expect(md).toMatch(/!\[image\]\(assets\/img-1\.png\)/);
  });

  it('skips headers and footers', () => {
    const md = renderMarkdown(makeDoc([
      makeBlock({ type: 'header', text: 'Company Header' }),
      makeBlock({ type: 'paragraph', text: 'Body' }),
      makeBlock({ type: 'footer', text: 'Page 1' }),
    ]));
    expect(md).not.toContain('Company Header');
    expect(md).not.toContain('Page 1');
    expect(md).toContain('Body');
  });

  it('adds page separators between pages', () => {
    const doc2: PdfDocument = {
      pageCount: 2,
      pages: [
        { pageNum: 1, width: 612, height: 792, blocks: [makeBlock({ type: 'paragraph', text: 'P1' })], scanPage: false },
        { pageNum: 2, width: 612, height: 792, blocks: [makeBlock({ type: 'paragraph', text: 'P2' })], scanPage: false },
      ],
    };
    const md = renderMarkdown(doc2, { pageSeparator: '\n\n---\n\n' });
    expect(md).toContain('P1\n\n---\n\nP2');
  });
});
