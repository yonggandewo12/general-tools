/**
 * Verify Mermaid diagrams are rendered correctly in the HTML output.
 */
import { describe, it, expect } from 'vitest';
import { MdConverter } from './src/md-converter.js';

const mdConverter = new MdConverter();

describe('Mermaid rendering', () => {
  it('converts mermaid code blocks to mermaid divs', async () => {
    const { html } = await mdConverter.convertMdToHtml(
      '# Test\n\n```mermaid\ngraph TD; A-->B;\n```\n',
      {},
    );
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('graph TD');
  });

  it('includes CDN script when mermaid is present', async () => {
    const { html } = await mdConverter.convertMdToHtml(
      '# Test\n\n```mermaid\ngraph TD; A-->B;\n```\n',
      { mermaidSource: 'auto' },
    );
    expect(html).toContain('mermaid@10');
    expect(html).toContain('mermaid.initialize');
    expect(html).toContain('scaleMermaidDiagrams');
  });

  it('skips CDN script when mermaidSource is none', async () => {
    const { html } = await mdConverter.convertMdToHtml(
      '# Test\n\n```mermaid\ngraph TD; A-->B;\n```\n',
      { mermaidSource: 'none' },
    );
    expect(html).not.toContain('mermaid@10');
    // Div still rendered
    expect(html).toContain('class="mermaid"');
  });

  it('computes scale with width and height constraints', async () => {
    const { html } = await mdConverter.convertMdToHtml(
      '# Test\n\n```mermaid\ngraph TD; A-->B;\n```\n',
      { mermaidSource: 'auto' },
    );
    expect(html).toContain('pageH');
    expect(html).toContain('scaleUp');
    expect(html).toContain('maxDown');
    expect(html).toContain('Math.min(scaleUp, maxDown)');
  });
});
