import { PdfConverter } from './src/pdf-converter.js';
import { MdConverter } from './src/md-converter.js';
import * as path from 'path';
import { promises as fs } from 'fs';

async function testMdToPdf() {
  const pdfConverter = new PdfConverter();
  const mdConverter = new MdConverter();

  // ── Test 1: MD content → styled HTML ──
  console.log('=== Test 1: MD → HTML ===\n');

  const markdown = `# My Test Report

This is a **test report** with various features.

## Lists

- Item one
- Item two
- Item three

## Table

| Name | Value | Description |
|------|-------|-------------|
| Alpha | 100 | First item |
| Beta | 200 | Second item |

## Code Block

\`\`\`typescript
function hello() {
  console.log("Hello, world!");
}
\`\`\`

## Blockquote

> This is a blockquote with some important content.
> It spans multiple lines.
`;

  const { html, stats } = await mdConverter.convertMdToHtml(markdown, {
    withJs: true,
  });

  console.log('Stats:', JSON.stringify(stats, null, 2));
  console.log('HTML length:', html.length, 'chars');
  console.log('Has TOC sidebar:', html.includes('toc-panel'));
  console.log('Has gradient h1:', html.includes('linear-gradient'));
  console.log('Has progress bar:', html.includes('.progress'));
  console.log('Has back-to-top:', html.includes('back-top'));

  // ── Test 2: MD content → PDF ──
  console.log('\n=== Test 2: MD → PDF ===\n');

  const pdfResult = await mdConverter.convertMdToPdf(
    {
      mdContent: markdown,
      withJs: true,
      format: 'A4',
    },
    pdfConverter,
  );

  if (pdfResult.success) {
    console.log('✅ PDF generated:', pdfResult.outputPath);
    console.log('⏱️  Processing time:', pdfResult.details?.processingTime + 'ms');
    console.log('📦 File size:', pdfResult.details?.fileSize
      ? (pdfResult.details.fileSize / 1024).toFixed(2) + ' KB'
      : 'unknown');
    if (pdfResult.details?.stats) {
      console.log('📊 Stats:', JSON.stringify(pdfResult.details.stats, null, 2));
    }
  } else {
    console.error('❌ Failed:', pdfResult.error);
  }

  // ── Test 3: MD file → PDF ──
  console.log('\n=== Test 3: MD file → PDF ===\n');

  const mdPath = path.join(process.cwd(), 'sample-md-test.md');
  const mdFileContent = `# File-Based Test

Testing the \`mdPath\` conversion route.

## Section One

Content for section one.

## Section Two

| Key | Value |
|-----|-------|
| A | 1 |
| B | 2 |
`;
  await fs.writeFile(mdPath, mdFileContent, 'utf-8');

  const fileResult = await mdConverter.convertMdToPdf(
    {
      mdPath,
      format: 'A4',
    },
    pdfConverter,
  );

  if (fileResult.success) {
    console.log('✅ PDF from file:', fileResult.outputPath);
    console.log('⏱️  Processing time:', fileResult.details?.processingTime + 'ms');
    console.log('📦 File size:', fileResult.details?.fileSize
      ? (fileResult.details.fileSize / 1024).toFixed(2) + ' KB'
      : 'unknown');
  } else {
    console.error('❌ Failed:', fileResult.error);
  }

  // Cleanup temp file
  await fs.unlink(mdPath).catch(() => {});

  await pdfConverter.cleanup();
  console.log('\n✅ All tests completed');
}

testMdToPdf().catch(console.error);
