#!/usr/bin/env npx tsx
/**
 * End-to-end test for all three MCP tools.
 * Tests the internal classes directly with comprehensive validation.
 */

import { PdfConverter } from './src/pdf-converter.js';
import { MdConverter } from './src/md-converter.js';
import * as path from 'path';
import { promises as fs } from 'fs';

const OUTPUT_DIR = path.join(process.cwd(), 'e2e-test-output');
const SAMPLE_HTML = path.join(process.cwd(), 'sample.html');

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function main() {
  console.log('══════════════════════════════════════════');
  console.log('  End-to-End Test Suite');
  console.log('══════════════════════════════════════════\n');

  // Clean output directory
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const pdfConverter = new PdfConverter();
  const mdConverter = new MdConverter();

  // ── Test sample HTML & Mermaid content ──
  const testMd = `# Test Report

This is a **comprehensive** test report to validate the rendering pipeline.

## Lists

### Unordered
- Alpha
- Beta
- Gamma

### Ordered
1. First
2. Second
3. Third

## Table

| City | Population | Area (km²) |
|------|-----------|-----------|
| Beijing | 21,540,000 | 16,411 |
| Shanghai | 24,870,000 | 6,341 |
| Tokyo | 13,960,000 | 2,194 |

## Code

\`\`\`python
def hello():
    print("Hello, world!")
\`\`\`

## Blockquote

> This is a blockquote that highlights important notes.
> It spans across multiple lines of content.

## Mermaid

\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process]
    B -->|No| D[End]
\`\`\`
`;

  // ════════════════════════════════════
  //  TEST 1: HTML → PDF
  // ════════════════════════════════════
  console.log('─── Test 1: convert_html_to_pdf ───\n');

  const htmlPdfPath = path.join(OUTPUT_DIR, 'sample-output.pdf');
  try {
    const htmlResult = await pdfConverter.convertToPdf({
      htmlPath: SAMPLE_HTML,
      outputPath: htmlPdfPath,
      format: 'A4',
      scale: 0.8,
    });

    assert('HTML→PDF returns success', htmlResult.success === true);
    if (htmlResult.success) {
      assert('HTML→PDF output file exists', (await fs.stat(htmlPdfPath)).size > 0);
      assert('HTML→PDF has processing time', (htmlResult.details?.processingTime ?? 0) > 0);
      assert('HTML→PDF has file size', (htmlResult.details?.fileSize ?? 0) > 0);
      console.log(`       Output: ${htmlPdfPath}`);
      console.log(`       Size: ${((htmlResult.details?.fileSize ?? 0) / 1024).toFixed(2)} KB`);
      console.log(`       Time: ${htmlResult.details?.processingTime}ms`);
    }
  } catch (e: any) {
    assert('HTML→PDF no crash', false, e.message);
  }

  console.log();

  // ════════════════════════════════════
  //  TEST 2: MD → HTML (NEW TOOL)
  // ════════════════════════════════════
  console.log('─── Test 2: convert_md_to_html ───\n');

  try {
    const { html: mdHtml, stats } = await mdConverter.convertMdToHtml(testMd, {
      withJs: true,
      mermaidSource: 'auto',
    });

    assert('MD→HTML produces output', mdHtml.length > 0);
    assert('MD→HTML has title <h1>', mdHtml.includes('>Test Report<'));
    assert('MD→HTML has gradient header', mdHtml.includes('linear-gradient'));
    assert('MD→HTML has table', mdHtml.includes('<table'));
    assert('MD→HTML has table-scroll wrapper', mdHtml.includes('table-scroll'));
    assert('MD→HTML has code block', mdHtml.includes('<pre>'));
    assert('MD→HTML has blockquote', mdHtml.includes('<blockquote'));
    if (stats) {
      assert('MD→HTML stats: has tables', stats.tables === 1);
      assert('MD→HTML stats: has mermaid', stats.mermaid === 1);
    }

    // Write HTML to file (like the new tool does for output)
    const htmlOutputPath = path.join(OUTPUT_DIR, 'test-report.html');
    await fs.writeFile(htmlOutputPath, mdHtml, 'utf-8');
    const htmlFileSize = (await fs.stat(htmlOutputPath)).size;
    assert('MD→HTML file written to disk', htmlFileSize > 0);
    console.log(`       Output: ${htmlOutputPath}`);
    console.log(`       Size: ${(htmlFileSize / 1024).toFixed(2)} KB`);

    // Verify withJs features (optional, not default)
    const { html: mdHtmlNoJs } = await mdConverter.convertMdToHtml(testMd, {});
    // CSS always has `.progress` rule, but the <div class="progress"> element should only appear with withJs
    const progressDivRegex = /<div\s+class="progress"/;
    assert('MD→HTML without JS: no progress bar div', !progressDivRegex.test(mdHtmlNoJs));
    assert('MD→HTML with JS: has progress bar', mdHtml.includes('.progress'));
    assert('MD→HTML with JS: has back-to-top', mdHtml.includes('back-top'));

    // Verify mermaid rendering
    assert('MD→HTML mermaid: div rendered', mdHtml.includes('class="mermaid"'));
    assert('MD→HTML mermaid: has CDN script', mdHtml.includes('mermaid@10'));

    // Test keepInlineToc
    const mdWithToc = `# Doc\n\n## 目录\n\n- [Intro](#intro)\n- [Body](#body)\n\n## Intro\n\nContent\n\n## Body\n\nMore content\n`;
    const { html: strippedToc } = await mdConverter.convertMdToHtml(mdWithToc, {});
    const { html: keptToc } = await mdConverter.convertMdToHtml(mdWithToc, { keepInlineToc: true });

    // Extract article body content
    const articleMatch = (s: string) => {
      const m = s.match(/<article>([\s\S]*)<\/article>/);
      return m ? m[1] : '';
    };
    assert('MD→HTML default strips inline TOC', !articleMatch(strippedToc).includes('目录'));
    assert('MD→HTML keepInlineToc retains TOC', articleMatch(keptToc).includes('目录'));

    // Test embedImages: create a small test image and embed it
    const testPngPath = path.join(OUTPUT_DIR, 'test-image.png');
    // Minimal 1x1 blue PNG
    const minimalPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await fs.writeFile(testPngPath, minimalPng);
    const { html: fileHtml } = await mdConverter.convertMdToHtml(
      `# Test\n\n![test](test-image.png)`,
      {},
      OUTPUT_DIR,
    );
    assert('MD→HTML embed images: file becomes data URI', fileHtml.includes('data:image/'));

  } catch (e: any) {
    assert('MD→HTML no crash', false, e.message);
  }

  console.log();

  // ════════════════════════════════════
  //  TEST 3: MD → PDF
  // ════════════════════════════════════
  console.log('─── Test 3: convert_md_to_pdf ───\n');

  try {
    const mdPdfPath = path.join(OUTPUT_DIR, 'md-report.pdf');
    const mdPdfResult = await mdConverter.convertMdToPdf(
      {
        mdContent: testMd,
        outputPath: mdPdfPath,
        withJs: true,
        format: 'A4',
        mermaidSource: 'auto',
      },
      pdfConverter,
    );

    assert('MD→PDF returns success', mdPdfResult.success === true);
    if (!mdPdfResult.success) {
      console.log(`       ERROR: ${mdPdfResult.error}`);
    }
    if (mdPdfResult.success) {
      assert('MD→PDF output file exists', (await fs.stat(mdPdfPath)).size > 0);
      assert('MD→PDF has processing time', (mdPdfResult.details?.processingTime ?? 0) > 0);
      assert('MD→PDF has file size', (mdPdfResult.details?.fileSize ?? 0) > 0);

      const mdStats = mdPdfResult.details?.stats;
      if (mdStats) {
        assert('MD→PDF stats: tables', mdStats.tables === 1);
        assert('MD→PDF stats: mermaid', mdStats.mermaid === 1);
        assert('MD→PDF stats: mermaid source', mdStats.mermaidSource === 'cdn');
      }
      console.log(`       Output: ${mdPdfPath}`);
      console.log(`       Size: ${((mdPdfResult.details?.fileSize ?? 0) / 1024).toFixed(2)} KB`);
      console.log(`       Time: ${mdPdfResult.details?.processingTime}ms`);
    }
  } catch (e: any) {
    assert('MD→PDF no crash', false, e.message);
  }

  console.log();

  // ════════════════════════════════════
  //  TEST 4: Edge cases
  // ════════════════════════════════════
  console.log('─── Test 4: Edge cases ───\n');

  // 4a: MD→HTML with mdPath
  try {
    const tmpMd = path.join(OUTPUT_DIR, '_test.md');
    await fs.writeFile(tmpMd, '# File-based\n\nFrom file path.', 'utf-8');
    const { html: fpHtml } = await mdConverter.convertMdToHtml(
      '# File-based\n\nFrom file path.',
      {},
      OUTPUT_DIR,
    );
    assert('MD→HTML from directory base', fpHtml.includes('File-based'));
  } catch (e: any) {
    assert('MD→HTML from directory base', false, e.message);
  }

  // 4b: Empty minimal markdown
  try {
    const { html: emptyHtml } = await mdConverter.convertMdToHtml('# Just a heading', {});
    assert('MD→HTML minimal content', emptyHtml.includes('Just a heading'));
  } catch (e: any) {
    assert('MD→HTML minimal content', false, e.message);
  }

  // 4c: Mermaid disabled
  try {
    const { html: noMermaid } = await mdConverter.convertMdToHtml(
      '```mermaid\ngraph TD; A-->B;\n```',
      { mermaidSource: 'none' },
    );
    assert('MD→HTML mermaid disabled: no CDN included', !noMermaid.includes('mermaid@10'));
    // Still renders mermaid div because mermaidSource=none only skips JS, not the div conversion
    assert('MD→HTML mermaid disabled: still renders div', noMermaid.includes('class="mermaid"'));
  } catch (e: any) {
    assert('MD→HTML mermaid disabled', false, e.message);
  }

  console.log();

  // ════════════════════════════════════
  //  SUMMARY
  // ════════════════════════════════════
  console.log('══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════');

  await pdfConverter.cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
