import { describe, it, expect } from 'vitest';
import { PptMasterService } from './src/ppt-master-service.js';
import { makeTextPdf, writeFixture } from './test-pdf-fixtures.js';

describe('convertToMarkdown (PDF branch, new engine)', () => {
  it('converts PDF to markdown file', async () => {
    const buf = await makeTextPdf([
      { text: 'Report Heading', x: 72, yTop: 80, size: 22, bold: true },
      { text: 'Content paragraph.', x: 72, yTop: 130 },
    ]);
    const pdfPath = await writeFixture('conv.pdf', buf);
    const service = new PptMasterService();
    const result = await service.convertToMarkdown({ source: pdfPath, sourceType: 'pdf' });
    expect(result.success).toBe(true);
    expect(result.markdownPath).toBeTruthy();
    const { promises: fs } = await import('fs');
    const md = await fs.readFile(result.markdownPath!, 'utf-8');
    expect(md).toContain('# Report Heading');
  });
});
